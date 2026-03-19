#!/usr/bin/env node

import dotenv from "dotenv";
import { bulkIndexDocuments, createElasticClient } from "../src/elastic-client.js";
import { createJiraClient } from "../src/jira-client.js";
import {
  buildCreatedEventDocument,
  buildHistoryEventDocuments,
  buildStatusCategoryById,
} from "../src/jira-event-document.js";
import { resolveJiraAuthConfig } from "../src/jira-config.js";
import {
  buildJiraSyncSignature,
  clearJiraSyncCheckpoint,
  getJiraSyncCheckpoint,
  setJiraSyncCheckpoint,
} from "../src/jira-sync-state.js";
import {
  appendJqlClauses,
  isTimestampInWindow,
  resolveJiraSyncWindow,
  sortDocumentsByTimestampDesc,
} from "../src/jira-sync-window.js";
import { loadSecretEnvValues } from "../src/secret-env.js";
import { loadState, saveState } from "../src/state-store.js";

dotenv.config();
loadSecretEnvValues();

try {
  const jiraConfig = resolveJiraAuthConfig();
  const jiraClient = createJiraClient(jiraConfig);
  const elasticClient = createElasticClient();
  const statusCategoryById = buildStatusCategoryById(await jiraClient.listStatuses());
  const syncWindow = resolveJiraSyncWindow();
  const stateFilePath = process.env.STATE_FILE || "./.jstats-state.json";
  const state = loadState(stateFilePath);
  const resumeEnabled = parseBooleanFlag(process.env.JIRA_SYNC_RESUME, true);
  const maxIssues = parsePositiveInteger(
    process.env.JIRA_EVENT_SYNC_MAX_ISSUES,
    20
  );
  const eventConcurrency = parsePositiveInteger(
    process.env.JIRA_EVENT_SYNC_CONCURRENCY,
    4
  );
  const pageSize = Math.min(
    maxIssues,
    parsePositiveInteger(process.env.JIRA_SYNC_PAGE_SIZE, 100)
  );
  const fields = ["summary", "project", "created", "creator"].join(",");

  let nextPageToken;
  let syncedIssues = 0;
  let indexedEvents = 0;
  const baseJql = appendJqlClauses(
    process.env.JIRA_JQL || "",
    syncWindow?.updatedJql
  );
  const searchJql = baseJql ? `${baseJql} ORDER BY updated DESC` : "ORDER BY updated DESC";
  const signature = buildJiraSyncSignature({
    organization: process.env.ORGANIZATION,
    baseUrl: jiraConfig.baseUrl,
    searchJql,
    projectKeys: jiraConfig.projectKeys,
    syncYear: syncWindow?.year,
    paginationMode: "nextPageToken",
  });
  const checkpoint = resumeEnabled
    ? getJiraSyncCheckpoint(state, "events", signature)
    : null;

  console.info(
    `Jira event sync config: max_issues=${maxIssues}, page_size=${pageSize}, concurrency=${eventConcurrency}, resume=${resumeEnabled}, year=${syncWindow?.year || "all"}`
  );
  if (!process.env.JIRA_EVENT_SYNC_MAX_ISSUES) {
    console.info(
      "Jira event sync is using the default max_issues=20; set JIRA_EVENT_SYNC_MAX_ISSUES for larger backfills."
    );
  }

  if (checkpoint) {
    nextPageToken = checkpoint.next_page_token || undefined;
    syncedIssues = checkpoint.synced_issues || 0;
    indexedEvents = checkpoint.indexed_events || 0;
    console.info(
      `Resuming Jira event sync from page token ${nextPageToken ? "present" : "start"}`
    );
  }

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

    console.info(
      `Processing Jira event page (${issues.length} issues, synced ${syncedIssues}/${maxIssues}, concurrency=${eventConcurrency}, newest=${issues[0]?.key}, oldest=${issues[issues.length - 1]?.key})`
    );

    let completedIssuesInPage = 0;
    const pageDocumentsByIssue = await mapWithConcurrency(
      issues,
      eventConcurrency,
      async (issue) => {
      const eventDocuments = [];
      const createdDoc = buildCreatedEventDocument(issue, {
        baseUrl: jiraConfig.baseUrl,
      });
      if (isTimestampInWindow(createdDoc.event_timestamp, syncWindow)) {
        eventDocuments.push(createdDoc);
      }

      const histories = await getAllChangelogEntries(jiraClient, issue.key);
      for (const history of histories) {
        const docs = buildHistoryEventDocuments(
          issue,
          history,
          statusCategoryById,
          { baseUrl: jiraConfig.baseUrl }
        );

        eventDocuments.push(
          ...docs.filter((doc) => isTimestampInWindow(doc.event_timestamp, syncWindow))
        );
      }

        const sortedDocuments = sortDocumentsByTimestampDesc(eventDocuments);
        completedIssuesInPage += 1;
        if (
          completedIssuesInPage % 10 === 0 ||
          completedIssuesInPage === issues.length
        ) {
          console.info(
            `Fetched changelogs for ${completedIssuesInPage}/${issues.length} issues in current page`
          );
        }
        return sortedDocuments;
      }
    );

    const pageDocuments = pageDocumentsByIssue.flat();

    await bulkIndexDocuments(elasticClient, "jstats-jira-event", pageDocuments);
    syncedIssues += issues.length;
    indexedEvents += pageDocuments.length;
    nextPageToken = page.nextPageToken || undefined;
    setJiraSyncCheckpoint(state, "events", signature, {
      next_page_token: nextPageToken || null,
      synced_issues: syncedIssues,
      indexed_events: indexedEvents,
      page_size: pageSize,
    });
    saveState(stateFilePath, state);
    console.info(
      `Indexed Jira event page (${issues.length} issues, ${pageDocuments.length} events, synced ${syncedIssues}/${maxIssues}, newest=${issues[0]?.key}, oldest=${issues[issues.length - 1]?.key})`
    );

    if (page.isLast || !nextPageToken) {
      break;
    }
  }

  clearJiraSyncCheckpoint(state, "events");
  saveState(stateFilePath, state);
  if (syncWindow) {
    console.info(
      `Event sync window: ${syncWindow.start} to ${syncWindow.end} (updated desc, events filtered by timestamp)`
    );
  }
  console.info(`Indexed ${indexedEvents} Jira events into jstats-jira-event`);
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

function parseBooleanFlag(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "n", "off"].includes(normalized)) {
    return false;
  }

  throw new Error(`Invalid boolean flag: ${value}`);
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
