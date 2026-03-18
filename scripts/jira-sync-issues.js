#!/usr/bin/env node

import dotenv from "dotenv";
import { bulkIndexDocuments, createElasticClient } from "../src/elastic-client.js";
import { createJiraClient } from "../src/jira-client.js";
import { resolveJiraAuthConfig } from "../src/jira-config.js";
import { buildJiraIssueDocument } from "../src/jira-issue-document.js";
import {
  buildJiraSyncSignature,
  clearJiraSyncCheckpoint,
  getJiraSyncCheckpoint,
  setJiraSyncCheckpoint,
} from "../src/jira-sync-state.js";
import {
  appendJqlClauses,
  resolveJiraSyncWindow,
} from "../src/jira-sync-window.js";
import { loadSecretEnvValues } from "../src/secret-env.js";
import { loadState, saveState } from "../src/state-store.js";

dotenv.config();
loadSecretEnvValues();

try {
  const jiraConfig = resolveJiraAuthConfig();
  const jiraClient = createJiraClient(jiraConfig);
  const elasticClient = createElasticClient();
  const syncWindow = resolveJiraSyncWindow();
  const stateFilePath = process.env.STATE_FILE || "./.jstats-state.json";
  const state = loadState(stateFilePath);
  const resumeEnabled = parseBooleanFlag(process.env.JIRA_SYNC_RESUME, true);
  const maxResults = parsePositiveInteger(
    process.env.JIRA_ISSUE_SYNC_MAX_RESULTS,
    100
  );
  const pageSize = Math.min(
    maxResults,
    parsePositiveInteger(process.env.JIRA_SYNC_PAGE_SIZE, 100)
  );
  const fields = [
    "summary",
    "status",
    "issuetype",
    "project",
    "created",
    "updated",
    "resolutiondate",
    "comment",
    "assignee",
    "reporter",
    "creator",
    "labels",
    "components",
    "fixVersions",
    "parent",
  ].join(",");

  let startAt = 0;
  let indexed = 0;
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
    ? getJiraSyncCheckpoint(state, "issues", signature)
    : null;

  if (checkpoint) {
    startAt = checkpoint.next_start_at || 0;
    indexed = checkpoint.indexed || 0;
    console.info(`Resuming Jira issue sync from offset ${startAt}`);
  }

  while (indexed < maxResults) {
    const page = await jiraClient.searchIssues({
      startAt,
      maxResults: Math.min(pageSize, maxResults - indexed),
      fields,
      jql: searchJql,
    });

    const issues = page.issues || [];
    if (issues.length === 0) {
      break;
    }

    const documents = issues.map((issue) =>
      buildJiraIssueDocument(issue, {
        baseUrl: jiraConfig.baseUrl,
      })
    );
    await bulkIndexDocuments(elasticClient, "jstats-jira-issue", documents);
    indexed += documents.length;

    const nextStartAt = startAt + issues.length;
    setJiraSyncCheckpoint(state, "issues", signature, {
      next_start_at: nextStartAt,
      indexed,
      page_size: pageSize,
    });
    saveState(stateFilePath, state);
    console.info(
      `Indexed Jira issues ${indexed}/${maxResults} (page size ${issues.length}, newest=${issues[0]?.key}, oldest=${issues[issues.length - 1]?.key})`
    );

    startAt = nextStartAt;
    if (issues.length < pageSize) {
      break;
    }
  }

  clearJiraSyncCheckpoint(state, "issues");
  saveState(stateFilePath, state);
  if (syncWindow) {
    console.info(
      `Issue sync window: ${syncWindow.start} to ${syncWindow.end} (updated desc)`
    );
  }
  console.info(`Indexed ${indexed} Jira issues into jstats-jira-issue`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
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
