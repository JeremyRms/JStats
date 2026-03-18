import test from "node:test";
import assert from "node:assert/strict";

import {
  buildJiraBasicAuthHeader,
  buildScopedJql,
  resolveJiraAuthConfig,
} from "../src/jira-config.js";

test("resolveJiraAuthConfig returns normalized config", () => {
  const config = resolveJiraAuthConfig({
    JIRA_BASE_URL: "https://example.atlassian.net/",
    JIRA_EMAIL: "user@example.com",
    JIRA_API_TOKEN: "secret-token",
  });

  assert.deepEqual(config, {
    baseUrl: "https://example.atlassian.net",
    email: "user@example.com",
    apiToken: "secret-token",
    projectKeys: [],
  });
});

test("resolveJiraAuthConfig parses project keys", () => {
  const config = resolveJiraAuthConfig({
    JIRA_BASE_URL: "https://example.atlassian.net",
    JIRA_EMAIL: "user@example.com",
    JIRA_API_TOKEN: "secret-token",
    JIRA_PROJECT_KEYS: "ARCH, BROK,ENG",
  });

  assert.deepEqual(config.projectKeys, ["ARCH", "BROK", "ENG"]);
});

test("resolveJiraAuthConfig reports missing values", () => {
  assert.throws(
    () => resolveJiraAuthConfig({ JIRA_EMAIL: "user@example.com" }),
    /Missing Jira configuration: JIRA_BASE_URL, JIRA_API_TOKEN/
  );
});

test("buildJiraBasicAuthHeader encodes email and token", () => {
  assert.equal(
    buildJiraBasicAuthHeader({
      email: "user@example.com",
      apiToken: "secret-token",
    }),
    `Basic ${Buffer.from("user@example.com:secret-token").toString("base64")}`
  );
});

test("buildScopedJql applies project scope and custom jql", () => {
  assert.equal(
    buildScopedJql(["ARCH", "ENG"], "statusCategory != Done"),
    "project in (ARCH,ENG) AND (statusCategory != Done)"
  );
});

test("buildScopedJql keeps order by outside the scoped filter", () => {
  assert.equal(
    buildScopedJql(["ARCH", "ENG"], "statusCategory != Done ORDER BY updated DESC"),
    "project in (ARCH,ENG) AND (statusCategory != Done) ORDER BY updated DESC"
  );
});
