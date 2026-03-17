#!/usr/bin/env node

import dotenv from "dotenv";
import { createJiraClient } from "../src/jira-client.js";
import { loadSecretEnvValues } from "../src/secret-env.js";
import { resolveJiraAuthConfig } from "../src/jira-config.js";

dotenv.config();
loadSecretEnvValues();

try {
  const config = resolveJiraAuthConfig();
  const jiraClient = createJiraClient(config);
  const user = await jiraClient.getCurrentUser();
  console.info(`Authenticated to ${config.baseUrl}`);
  console.info(`Jira user: ${user.displayName || user.accountId}`);
  if (user.emailAddress) {
    console.info(`Email: ${user.emailAddress}`);
  }
  if (user.accountId) {
    console.info(`Account ID: ${user.accountId}`);
  }
  if (user.accountType) {
    console.info(`Account type: ${user.accountType}`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
