#!/usr/bin/env node

import dotenv from "dotenv";
import pkg from "octokit";

import { createElasticClient } from "../src/elastic-client.js";
import {
  ARCHIVED_REPO_INDICES,
  buildArchivedRepoQuery,
  collectArchivedRepositoryNames,
  parseBooleanFlag,
} from "../src/archived-repo-cleanup.js";
import { loadSecretEnvValues } from "../src/secret-env.js";
import { loadState, removeRepos, saveState } from "../src/state-store.js";

const { Octokit } = pkg;

dotenv.config();
loadSecretEnvValues();

try {
  const organization = process.env.ORGANIZATION?.trim();
  if (!organization) {
    throw new Error("Missing GitHub configuration: ORGANIZATION");
  }
  if (!process.env.API_KEY?.trim()) {
    throw new Error("Missing GitHub configuration: API_KEY");
  }

  const dryRun = parseBooleanFlag(process.env.ARCHIVED_REPO_CLEANUP_DRY_RUN, false);
  const stateFilePath = process.env.STATE_FILE || "./.jstats-state.json";
  const githubClient = new Octokit({
    auth: process.env.API_KEY,
    userAgent: "JStats cleanup",
    timeZone: process.env.TIMEZONE,
  });
  const elasticClient = createElasticClient();

  const repositories = await githubClient.paginate(
    githubClient.rest.repos.listForOrg,
    {
      org: organization,
      type: "private",
      sort: "updated",
      direction: "desc",
      per_page: 100,
    },
    (response) => response.data
  );

  const archivedRepositoryNames = collectArchivedRepositoryNames(repositories);
  if (archivedRepositoryNames.length === 0) {
    console.info(`No archived repositories found for ${organization}`);
    process.exit(0);
  }

  console.info(
    `${archivedRepositoryNames.length} archived repositories found for ${organization}`
  );
  console.info(`Mode: ${dryRun ? "dry-run" : "delete"}`);
  console.info(`Repositories: ${archivedRepositoryNames.join(", ")}`);

  const deleteQuery = buildArchivedRepoQuery(archivedRepositoryNames);
  for (const index of ARCHIVED_REPO_INDICES) {
    const countResponse = await elasticClient.count({
      index,
      body: deleteQuery,
      ignore_unavailable: true,
      allow_no_indices: true,
    });
    const matches = countResponse.body?.count ?? countResponse.count ?? 0;

    if (matches === 0) {
      console.info(`${index}: 0 matching documents`);
      continue;
    }

    if (dryRun) {
      console.info(`${index}: would delete ${matches} documents`);
      continue;
    }

    const deleteResponse = await elasticClient.deleteByQuery({
      index,
      body: deleteQuery,
      conflicts: "proceed",
      refresh: true,
      ignore_unavailable: true,
      allow_no_indices: true,
    });
    const deleted = deleteResponse.body?.deleted ?? deleteResponse.deleted ?? 0;
    console.info(`${index}: deleted ${deleted} documents`);
  }

  const state = loadState(stateFilePath);
  const removedStateEntries = removeRepos(state, archivedRepositoryNames);
  if (dryRun) {
    console.info(
      `${stateFilePath}: would remove ${removedStateEntries} archived repository state entries`
    );
  } else {
    saveState(stateFilePath, state);
    console.info(
      `${stateFilePath}: removed ${removedStateEntries} archived repository state entries`
    );
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
