import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { loadSecretEnvValues } from "../src/secret-env.js";

test("loadSecretEnvValues maps GITHUB_TOKEN to API_KEY and reads Jira token file", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jstats-secret-env-"));
  const jiraSecretPath = path.join(tempDir, "jira_api_token");
  fs.writeFileSync(jiraSecretPath, "jira-from-file\n");

  const env = {
    GITHUB_TOKEN: "github-from-token",
    JIRA_API_TOKEN: "jira-from-env",
    JIRA_API_TOKEN_FILE: jiraSecretPath,
  };

  loadSecretEnvValues(env);

  assert.equal(env.API_KEY, "github-from-token");
  assert.equal(env.JIRA_API_TOKEN, "jira-from-file");
});

test("loadSecretEnvValues preserves API_KEY and falls back to Jira env value", () => {
  const env = {
    API_KEY: "github-from-env",
    GITHUB_TOKEN: "github-from-token",
    JIRA_API_TOKEN: "jira-from-env",
    JIRA_API_TOKEN_FILE: "/tmp/jstats-missing-jira-secret",
  };

  loadSecretEnvValues(env);

  assert.equal(env.API_KEY, "github-from-env");
  assert.equal(env.JIRA_API_TOKEN, "jira-from-env");
});
