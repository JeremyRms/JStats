import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  getRepoPullWatermark,
  loadState,
  removeRepos,
  saveState,
  setRepoPullWatermark,
} from "../src/state-store.js";

test("loadState returns defaults when file does not exist", () => {
  const state = loadState("/tmp/this-file-should-not-exist-jstats-state.json");

  assert.equal(state.version, 1);
  assert.deepEqual(state.repos, {});
  assert.deepEqual(state.jira_sync, {});
});

test("set/get repo watermark and save/load roundtrip", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jstats-state-"));
  const stateFile = path.join(tempDir, "state.json");

  const state = loadState(stateFile);
  setRepoPullWatermark(state, "repo-one", "2026-03-10T10:00:00Z");
  saveState(stateFile, state);

  const loaded = loadState(stateFile);
  assert.equal(
    getRepoPullWatermark(loaded, "repo-one"),
    "2026-03-10T10:00:00Z"
  );
  assert.ok(loaded.repos["repo-one"].last_run_at);
});

test("removeRepos deletes repository state entries", () => {
  const state = loadState("/tmp/this-file-should-not-exist-jstats-state.json");
  setRepoPullWatermark(state, "repo-one", "2026-03-10T10:00:00Z");
  setRepoPullWatermark(state, "repo-two", "2026-03-11T10:00:00Z");

  const removed = removeRepos(state, ["repo-two", "repo-three"]);

  assert.equal(removed, 1);
  assert.equal(getRepoPullWatermark(state, "repo-two"), undefined);
  assert.equal(
    getRepoPullWatermark(state, "repo-one"),
    "2026-03-10T10:00:00Z"
  );
});
