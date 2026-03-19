import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { loadSecretEnvValues } from "../src/secret-env.js";

test("loadSecretEnvValues prefers secret files over env values", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jstats-secret-env-"));
  const githubSecretPath = path.join(tempDir, "github_api_key");
  const jiraSecretPath = path.join(tempDir, "jira_api_token");
  fs.writeFileSync(githubSecretPath, "github-from-file\n");
  fs.writeFileSync(jiraSecretPath, "jira-from-file\n");

  const env = {
    API_KEY: "github-from-env",
    GITHUB_API_KEY_FILE: githubSecretPath,
    JIRA_API_TOKEN: "jira-from-env",
    JIRA_API_TOKEN_FILE: jiraSecretPath,
  };

  loadSecretEnvValues(env);

  assert.equal(env.API_KEY, "github-from-file");
  assert.equal(env.JIRA_API_TOKEN, "jira-from-file");
});

test("loadSecretEnvValues falls back to env when secret files are absent", () => {
  const env = {
    API_KEY: "github-from-env",
    GITHUB_API_KEY_FILE: "/tmp/jstats-missing-github-secret",
    JIRA_API_TOKEN: "jira-from-env",
    JIRA_API_TOKEN_FILE: "/tmp/jstats-missing-jira-secret",
  };

  loadSecretEnvValues(env);

  assert.equal(env.API_KEY, "github-from-env");
  assert.equal(env.JIRA_API_TOKEN, "jira-from-env");
});
