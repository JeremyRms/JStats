import test from "node:test";
import assert from "node:assert/strict";

import { isRetryableError, withRetry } from "../src/retry.js";

test("isRetryableError accepts transient network faults", () => {
  assert.equal(isRetryableError(new Error("fetch failed")), true);
  assert.equal(isRetryableError(new Error("read ECONNRESET")), true);
  assert.equal(isRetryableError(new Error("socket hang up")), true);
});

test("isRetryableError accepts rate limits and server faults", () => {
  assert.equal(
    isRetryableError(new Error("Jira request failed with HTTP 429")),
    true
  );
  assert.equal(
    isRetryableError(new Error("Jira request failed with HTTP 503: busy")),
    true
  );
});

test("isRetryableError rejects permanent client faults", () => {
  assert.equal(
    isRetryableError(new Error("Jira request failed with HTTP 401")),
    false
  );
  assert.equal(
    isRetryableError(new Error("Jira request failed with HTTP 400: bad jql")),
    false
  );
  assert.equal(isRetryableError(new Error("Invalid JIRA_QA_STATUSES")), false);
});

test("withRetry returns the first successful result", async () => {
  let calls = 0;
  const result = await withRetry("op", async () => {
    calls += 1;
    return "ok";
  });

  assert.equal(result, "ok");
  assert.equal(calls, 1);
});

test("withRetry retries a transient fault and then succeeds", async () => {
  const delays = [];
  let calls = 0;

  const result = await withRetry(
    "op",
    async () => {
      calls += 1;
      if (calls < 3) {
        throw new Error("fetch failed");
      }
      return "ok";
    },
    { sleep: async (ms) => delays.push(ms), log: () => {} }
  );

  assert.equal(result, "ok");
  assert.equal(calls, 3);
  assert.deepEqual(delays, [1000, 2000]);
});

test("withRetry gives up after the attempt limit", async () => {
  let calls = 0;

  await assert.rejects(
    withRetry(
      "op",
      async () => {
        calls += 1;
        throw new Error("fetch failed");
      },
      { attempts: 3, sleep: async () => {}, log: () => {} }
    ),
    /fetch failed/
  );

  assert.equal(calls, 3);
});

test("withRetry does not retry a permanent fault", async () => {
  let calls = 0;

  await assert.rejects(
    withRetry(
      "op",
      async () => {
        calls += 1;
        throw new Error("Jira request failed with HTTP 401");
      },
      { sleep: async () => {}, log: () => {} }
    ),
    /HTTP 401/
  );

  assert.equal(calls, 1);
});
