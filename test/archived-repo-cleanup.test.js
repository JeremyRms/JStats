import test from "node:test";
import assert from "node:assert/strict";

import {
  ARCHIVED_REPO_INDICES,
  buildArchivedRepoQuery,
  collectArchivedRepositoryNames,
  parseBooleanFlag,
} from "../src/archived-repo-cleanup.js";
import { removeRepos } from "../src/state-store.js";

test("collectArchivedRepositoryNames returns archived repo names in order", () => {
  assert.deepEqual(
    collectArchivedRepositoryNames([
      { name: "repo-z", archived: true },
      { name: "repo-a", archived: true },
      { name: "repo-b", archived: false },
      { archived: true },
    ]),
    ["repo-a", "repo-z"]
  );
});

test("buildArchivedRepoQuery matches repository keyword terms", () => {
  assert.deepEqual(buildArchivedRepoQuery(["repo-a", "repo-b"]), {
    query: {
      terms: {
        "repository.keyword": ["repo-a", "repo-b"],
      },
    },
  });
});

test("parseBooleanFlag supports explicit true and false values", () => {
  assert.equal(parseBooleanFlag("true"), true);
  assert.equal(parseBooleanFlag("0"), false);
  assert.equal(parseBooleanFlag(undefined, true), true);
});

test("parseBooleanFlag rejects invalid values", () => {
  assert.throws(() => parseBooleanFlag("maybe"), /Invalid boolean flag/);
});

test("removeRepos prunes matching repository state entries", () => {
  const state = {
    version: 1,
    repos: {
      "repo-a": { last_pull_updated_at: "2026-03-10T10:00:00Z" },
      "repo-b": { last_pull_updated_at: "2026-03-11T10:00:00Z" },
    },
  };

  const removed = removeRepos(state, ["repo-b", "repo-c"]);

  assert.equal(removed, 1);
  assert.deepEqual(Object.keys(state.repos), ["repo-a"]);
});

test("archived repo cleanup targets the expected indices", () => {
  assert.deepEqual(ARCHIVED_REPO_INDICES, [
    "jstats-repository",
    "jstats-teams",
    "jstats-pullrequest",
    "jstats-review",
    "jstats-comment",
  ]);
});
