#!/usr/bin/env node

import dotenv from "dotenv";
import { createElasticClient } from "../src/elastic-client.js";
import { createJiraClient } from "../src/jira-client.js";
import { resolveJiraAuthConfig } from "../src/jira-config.js";
import { buildJiraIssueDocument } from "../src/jira-issue-document.js";
import { loadSecretEnvValues } from "../src/secret-env.js";

dotenv.config();
loadSecretEnvValues();

try {
  const jiraConfig = resolveJiraAuthConfig();
  const jiraClient = createJiraClient(jiraConfig);
  const elasticClient = createElasticClient();
  const maxResults = parsePositiveInteger(
    process.env.JIRA_ISSUE_SYNC_MAX_RESULTS,
    100
  );
  const pageSize = Math.min(maxResults, 50);
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

  while (indexed < maxResults) {
    const page = await jiraClient.searchIssues({
      startAt,
      maxResults: Math.min(pageSize, maxResults - indexed),
      fields,
      jql: `${process.env.JIRA_JQL || ""} ORDER BY updated DESC`.trim(),
    });

    const issues = page.issues || [];
    if (issues.length === 0) {
      break;
    }

    for (const issue of issues) {
      const doc = buildJiraIssueDocument(issue, {
        baseUrl: jiraConfig.baseUrl,
      });
      await elasticClient.index({
        index: "jstats-jira-issue",
        id: issue.id,
        body: doc,
      });
      indexed += 1;
      console.info(`Indexed Jira issue ${issue.key} (${indexed}/${maxResults})`);
    }

    startAt += issues.length;
    if (issues.length < pageSize) {
      break;
    }
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

