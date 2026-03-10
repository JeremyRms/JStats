import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  getRepoPullWatermark,
  loadState,
  saveState,
  setRepoPullWatermark,
} from "../src/state-store.js";

test("loadState returns defaults when file does not exist", () => {
  const state = loadState("/tmp/this-file-should-not-exist-jstats-state.json");

  assert.equal(state.version, 1);
  assert.deepEqual(state.repos, {});
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
