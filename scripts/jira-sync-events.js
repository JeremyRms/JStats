#!/usr/bin/env node

import dotenv from "dotenv";
import { createElasticClient } from "../src/elastic-client.js";
import { createJiraClient } from "../src/jira-client.js";
import {
  buildCreatedEventDocument,
  buildHistoryEventDocuments,
  buildStatusCategoryById,
} from "../src/jira-event-document.js";
import { resolveJiraAuthConfig } from "../src/jira-config.js";
import { loadSecretEnvValues } from "../src/secret-env.js";

dotenv.config();
loadSecretEnvValues();

try {
  const jiraConfig = resolveJiraAuthConfig();
  const jiraClient = createJiraClient(jiraConfig);
  const elasticClient = createElasticClient();
  const statusCategoryById = buildStatusCategoryById(await jiraClient.listStatuses());
  const maxIssues = parsePositiveInteger(
    process.env.JIRA_EVENT_SYNC_MAX_ISSUES,
    20
  );
  const pageSize = Math.min(maxIssues, 50);
  const fields = ["summary", "project", "created", "creator"].join(",");

  let startAt = 0;
  let syncedIssues = 0;
  let indexedEvents = 0;

  while (syncedIssues < maxIssues) {
    const page = await jiraClient.searchIssues({
      startAt,
      maxResults: Math.min(pageSize, maxIssues - syncedIssues),
      fields,
      jql: `${process.env.JIRA_JQL || ""} ORDER BY updated DESC`.trim(),
    });

    const issues = page.issues || [];
    if (issues.length === 0) {
      break;
    }

    for (const issue of issues) {
      const createdDoc = buildCreatedEventDocument(issue, {
        baseUrl: jiraConfig.baseUrl,
      });
      await elasticClient.index({
        index: "jstats-jira-event",
        id: createdDoc.id,
        body: createdDoc,
      });
      indexedEvents += 1;

      const histories = await getAllChangelogEntries(jiraClient, issue.key);
      for (const history of histories) {
        const docs = buildHistoryEventDocuments(
          issue,
          history,
          statusCategoryById,
          { baseUrl: jiraConfig.baseUrl }
        );

        for (const doc of docs) {
          await elasticClient.index({
            index: "jstats-jira-event",
            id: doc.id,
            body: doc,
          });
          indexedEvents += 1;
        }
      }

      syncedIssues += 1;
      console.info(
        `Indexed Jira events for ${issue.key} (${syncedIssues}/${maxIssues} issues, ${indexedEvents} events)`
      );
    }

    startAt += issues.length;
    if (issues.length < pageSize) {
      break;
    }
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

