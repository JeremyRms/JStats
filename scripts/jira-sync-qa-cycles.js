#!/usr/bin/env node

import dotenv from "dotenv";
import { bulkIndexDocuments, createElasticClient } from "../src/elastic-client.js";
import { createJiraClient } from "../src/jira-client.js";
import { resolveJiraAuthConfig } from "../src/jira-config.js";
import {
  buildQaCycleDocument,
  resolveQaStatuses,
} from "../src/jira-qa-cycle-document.js";
import {
  appendJqlClauses,
  resolveJiraSyncWindow,
} from "../src/jira-sync-window.js";
import { loadSecretEnvValues } from "../src/secret-env.js";

dotenv.config();
loadSecretEnvValues();

try {
  const jiraConfig = resolveJiraAuthConfig();
  const jiraClient = createJiraClient(jiraConfig);
  const elasticClient = createElasticClient();
  const syncWindow = resolveJiraSyncWindow();
  const qaStatuses = resolveQaStatuses();
  const maxIssues = parsePositiveInteger(
    process.env.JIRA_QA_SYNC_MAX_ISSUES,
    500
  );
  const concurrency = parsePositiveInteger(
    process.env.JIRA_QA_SYNC_CONCURRENCY,
    4
  );
  const pageSize = Math.min(
    maxIssues,
    parsePositiveInteger(process.env.JIRA_SYNC_PAGE_SIZE, 100)
  );
  const fields = [
    "summary",
    "project",
    "issuetype",
    "assignee",
    "fixVersions",
    "customfield_10004",
  ].join(",");

  const baseJql = appendJqlClauses(
    process.env.JIRA_JQL || "",
    syncWindow?.updatedJql
  );
  const searchJql = baseJql
    ? `${baseJql} ORDER BY updated DESC`
    : "ORDER BY updated DESC";

  console.info(
    `Jira QA cycle sync config: max_issues=${maxIssues}, page_size=${pageSize}, concurrency=${concurrency}, year=${syncWindow?.year || "all"}, qa_statuses=[${[...qaStatuses].join(", ")}]`
  );

  let nextPageToken;
  let syncedIssues = 0;
  let indexedCycles = 0;

  while (syncedIssues < maxIssues) {
    const page = await jiraClient.searchIssues({
      maxResults: Math.min(pageSize, maxIssues - syncedIssues),
      fields,
      jql: searchJql,
      nextPageToken,
    });

    const issues = page.issues || [];
    if (issues.length === 0) {
      break;
    }

    const documentsByIssue = await mapWithConcurrency(
      issues,
      concurrency,
      async (issue) => {
        const histories = await getAllChangelogEntries(jiraClient, issue.key);
        return buildQaCycleDocument(issue, histories, qaStatuses, {
          baseUrl: jiraConfig.baseUrl,
        });
      }
    );

    const documents = documentsByIssue.filter(Boolean);
    await bulkIndexDocuments(elasticClient, "jstats-jira-qa-cycle", documents);
    syncedIssues += issues.length;
    indexedCycles += documents.length;
    nextPageToken = page.nextPageToken || undefined;
    console.info(
      `Indexed QA cycle page (${issues.length} issues, ${documents.length} cycles, synced ${syncedIssues}/${maxIssues}, newest=${issues[0]?.key}, oldest=${issues[issues.length - 1]?.key})`
    );

    if (page.isLast || !nextPageToken) {
      break;
    }
  }

  console.info(
    `Indexed ${indexedCycles} QA cycle documents into jstats-jira-qa-cycle`
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

async function getAllChangelogEntries(jiraClient, issueKey) {
  const histories = [];
  let startAt = 0;
  const maxResults = 100;

  for (;;) {
    const page = await jiraClient.getIssueChangelog(issueKey, {
      startAt,
      maxResults,
    });
    const values = page.values || [];
    histories.push(...values);

    if (page.isLast || values.length === 0) {
      return histories;
    }

    startAt += values.length;
  }
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }

  return fallback;
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    for (;;) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= items.length) {
        return;
      }

      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
