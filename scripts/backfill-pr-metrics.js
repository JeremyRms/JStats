#!/usr/bin/env node

import dotenv from "dotenv";
import { createElasticClient } from "../src/elastic-client.js";
import { enrichPullRequestMetrics } from "../src/document-enrichment.js";
import { loadSecretEnvValues } from "../src/secret-env.js";

dotenv.config();
loadSecretEnvValues();

const PAGE_SIZE = 500;

try {
  const client = createElasticClient();
  let searchAfter;
  let scanned = 0;
  let updated = 0;

  for (;;) {
    const response = await client.search({
      index: "jstats-pullrequest",
      size: PAGE_SIZE,
      sort: [{ id: "asc" }],
      ...(searchAfter ? { search_after: searchAfter } : {}),
      _source: ["id", "created_at", "merged_at", "user.id", "diff"],
    });
    const result = response.body || response;
    const hits = result.hits?.hits || [];
    if (hits.length === 0) {
      break;
    }

    const pullIds = hits.map((hit) => hit._source.id);
    const reviewsByPull = await fetchReviewsByPull(client, pullIds);

    const operations = [];
    for (const hit of hits) {
      scanned += 1;
      const source = hit._source;
      const doc = {
        created_at: source.created_at,
        merged_at: source.merged_at,
        user: source.user,
        diff: source.diff,
      };
      enrichPullRequestMetrics(doc, reviewsByPull.get(source.id) || []);

      const fields = {};
      for (const key of [
        "pr_size",
        "pr_changed_files",
        "merge_lead_time_seconds",
        "pr_time_to_merge_days",
        "first_review_submitted_at",
        "first_review_latency_seconds",
        "first_review_latency_hours",
      ]) {
        if (doc[key] !== undefined) {
          fields[key] = doc[key];
        }
      }

      if (Object.keys(fields).length > 0) {
        operations.push({ update: { _index: hit._index, _id: hit._id } });
        operations.push({ doc: fields });
        updated += 1;
      }
    }

    if (operations.length > 0) {
      const bulkResponse = await client.bulk({ refresh: false, operations });
      const bulkResult = bulkResponse.body || bulkResponse;
      if (bulkResult.errors) {
        const firstError = bulkResult.items.find((item) => item.update?.error);
        throw new Error(
          `Bulk update failed: ${JSON.stringify(firstError?.update?.error)}`
        );
      }
    }

    console.info(`Backfilled ${updated}/${scanned} pull request documents`);
    searchAfter = hits[hits.length - 1].sort;
  }

  await client.indices.refresh({ index: "jstats-pullrequest" });
  console.info(
    `Backfill complete: ${updated} of ${scanned} pull request documents updated`
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

async function fetchReviewsByPull(client, pullIds) {
  const reviewsByPull = new Map();
  if (pullIds.length === 0) {
    return reviewsByPull;
  }

  const response = await client.search({
    index: "jstats-review",
    size: 10000,
    query: { terms: { pull_request_id: pullIds } },
    _source: ["pull_request_id", "submitted_at", "user.id"],
  });
  const result = response.body || response;
  for (const hit of result.hits?.hits || []) {
    const source = hit._source;
    const list = reviewsByPull.get(source.pull_request_id) || [];
    list.push(source);
    reviewsByPull.set(source.pull_request_id, list);
  }

  return reviewsByPull;
}
