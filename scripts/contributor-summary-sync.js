#!/usr/bin/env node

import dotenv from "dotenv";
import {
  bulkIndexDocuments,
  createElasticClient,
} from "../src/elastic-client.js";
import {
  loadTeamDirectory,
  resolveTeamDirectoryFile,
} from "../src/team-directory.js";

dotenv.config({ path: process.env.ENV_FILE || ".env" });

try {
  const filePath = resolveTeamDirectoryFile();
  const directory = loadTeamDirectory(filePath);
  const elasticClient = createElasticClient();
  const teamByKey = new Map(directory.teams.map((team) => [team.key, team]));

  const [mergedPrCounts, reviewCounts, commentCounts] = await Promise.all([
    aggregateGithubActivity(elasticClient, "jstats-pullrequest", {
      bool: {
        filter: [{ exists: { field: "merged_at" } }],
        must_not: [{ term: { actor_is_bot: true } }],
      },
    }),
    aggregateGithubActivity(elasticClient, "jstats-review", {
      bool: {
        must_not: [{ term: { actor_is_bot: true } }],
      },
    }),
    aggregateGithubActivity(elasticClient, "jstats-comment", {
      bool: {
        must_not: [{ term: { actor_is_bot: true } }],
      },
    }),
  ]);

  const documents = directory.members
    .filter((member) => member.active)
    .map((member) => {
      const team = teamByKey.get(member.team_key);
      const login = member.github_login || null;
      const mergedPrCount = login ? mergedPrCounts.get(login) || 0 : 0;
      const reviewCount = login ? reviewCounts.get(login) || 0 : 0;
      const commentCount = login ? commentCounts.get(login) || 0 : 0;

      return {
        id: `member:${member.key}`,
        entity_type: "contributor_summary",
        source: "team_directory",
        member_key: member.key,
        team_key: member.team_key,
        team_name: team?.name || null,
        full_name: member.full_name,
        nickname: member.nickname,
        display_name: member.nickname || member.full_name,
        role: member.role,
        github_login: login,
        has_github_login: Boolean(login),
        active: member.active,
        merged_pr_count: mergedPrCount,
        review_count: reviewCount,
        comment_count: commentCount,
        total_contribution_count: mergedPrCount + reviewCount + commentCount,
        ingested_at: new Date().toISOString(),
      };
    });

  await replaceIndexDocuments(
    elasticClient,
    "jstats-contributor-summary",
    documents
  );

  console.info(`Loaded team directory from ${filePath}`);
  console.info(
    `Indexed ${documents.length} contributors into jstats-contributor-summary`
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

async function aggregateGithubActivity(client, index, query) {
  const response = await client.search({
    index,
    size: 0,
    query,
    aggs: {
      by_user: {
        terms: {
          field: "user.login.keyword",
          size: 10000,
        },
      },
    },
  });
  const result = response.body || response;
  const buckets = result.aggregations?.by_user?.buckets || [];
  return new Map(buckets.map((bucket) => [bucket.key, bucket.doc_count]));
}

async function replaceIndexDocuments(client, index, documents) {
  await client.deleteByQuery(
    {
      index,
      conflicts: "proceed",
      refresh: true,
      query: {
        match_all: {},
      },
    },
    {
      ignore: [404],
    }
  );

  if (!documents.length) {
    return 0;
  }

  return bulkIndexDocuments(client, index, documents);
}
