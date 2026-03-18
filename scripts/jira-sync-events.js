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
  const pageSize = Math.min(
    maxIssues,
    parsePositiveInteger(process.env.JIRA_SYNC_PAGE_SIZE, 100)
  );
  const fields = ["summary", "project", "created", "creator"].join(",");

  let startAt = 0;
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
  });
  const checkpoint = resumeEnabled
    ? getJiraSyncCheckpoint(state, "events", signature)
    : null;

  if (checkpoint) {
    startAt = checkpoint.next_start_at || 0;
    syncedIssues = checkpoint.synced_issues || 0;
    indexedEvents = checkpoint.indexed_events || 0;
    console.info(`Resuming Jira event sync from offset ${startAt}`);
  }

  while (syncedIssues < maxIssues) {
    const page = await jiraClient.searchIssues({
      startAt,
      maxResults: Math.min(pageSize, maxIssues - syncedIssues),
      fields,
      jql: searchJql,
    });

    const issues = page.issues || [];
    if (issues.length === 0) {
      break;
    }

    for (const [issueIndex, issue] of issues.entries()) {
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
      await bulkIndexDocuments(elasticClient, "jstats-jira-event", sortedDocuments);
      indexedEvents += sortedDocuments.length;

      syncedIssues += 1;
      setJiraSyncCheckpoint(state, "events", signature, {
        next_start_at: startAt + issueIndex + 1,
        synced_issues: syncedIssues,
        indexed_events: indexedEvents,
        page_size: pageSize,
      });
      saveState(stateFilePath, state);
      console.info(
        `Indexed Jira events for ${issue.key} (${syncedIssues}/${maxIssues} issues, ${indexedEvents} events)`
      );
    }

    startAt += issues.length;
    if (issues.length < pageSize) {
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
