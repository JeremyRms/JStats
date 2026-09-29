import test from "node:test";
import assert from "node:assert/strict";

import {
  buildQaCycleDocument,
  resolveQaStatuses,
  resolveForwardStatuses,
  resolveCancelledStatuses,
} from "../src/jira-qa-cycle-document.js";

const issue = {
  key: "BROK-1",
  id: "10001",
  fields: {
    summary: "Example issue",
    project: { key: "BROK" },
    issuetype: { name: "Story" },
    assignee: { displayName: "Example Person" },
    fixVersions: [{ name: "2026.07" }],
    customfield_10004: 3,
  },
};

const QA = resolveQaStatuses({ JIRA_QA_STATUSES: "In QA,QA,Testing,Ready for Testing" });
const CTX = {
  baseUrl: "https://example.atlassian.net",
  forwardStatuses: resolveForwardStatuses({}),
  cancelledStatuses: resolveCancelledStatuses({}),
};

function history(created, from, to) {
  return { created, items: [{ field: "status", fromString: from, toString: to }] };
}

test("resolveQaStatuses is case-insensitive and env-driven", () => {
  const s = resolveQaStatuses({ JIRA_QA_STATUSES: "IN QA, Waiting QA" });
  assert.deepEqual([...s], ["in qa", "waiting qa"]);
  assert.ok(resolveQaStatuses({}).has("in qa"));
});

test("clean pass: one visit, forward exit, no bounce", () => {
  const doc = buildQaCycleDocument(
    issue,
    [
      history("2026-01-01T00:00:00.000Z", "In Progress", "In QA"),
      history("2026-01-01T12:00:00.000Z", "In QA", "Passed QA"),
      history("2026-01-02T00:00:00.000Z", "Passed QA", "Pending Release"),
    ],
    QA,
    CTX
  );
  assert.equal(doc.qa_entries, 1);
  assert.equal(doc.qa_bounces, 0);
  assert.equal(doc.qa_bounced, false);
  assert.equal(doc.qa_end_status, "Passed QA");
  assert.equal(doc.qa_cycle_seconds, 12 * 3600);
  assert.equal(doc.qa_open, false);
});

test("single bounce: QA sends it back once, then it passes", () => {
  const doc = buildQaCycleDocument(
    issue,
    [
      history("2026-01-01T00:00:00.000Z", "In Progress", "In QA"),
      history("2026-01-01T06:00:00.000Z", "In QA", "In Progress"),
      history("2026-01-02T00:00:00.000Z", "In Progress", "In QA"),
      history("2026-01-02T06:00:00.000Z", "In QA", "Passed QA"),
    ],
    QA,
    CTX
  );
  assert.equal(doc.qa_entries, 2);
  assert.equal(doc.qa_bounces, 1);
  assert.equal(doc.qa_bounced, true);
  // cycle spans first entry to the forward exit, not the first bounce
  assert.equal(doc.qa_end_status, "Passed QA");
  assert.equal(doc.qa_cycle_seconds, 30 * 3600);
});

test("multiple bounces are all counted", () => {
  const doc = buildQaCycleDocument(
    issue,
    [
      history("2026-01-01T00:00:00.000Z", "In Progress", "In QA"),
      history("2026-01-01T01:00:00.000Z", "In QA", "In Progress"),
      history("2026-01-01T02:00:00.000Z", "In Progress", "In QA"),
      history("2026-01-01T03:00:00.000Z", "In QA", "Code Review"),
      history("2026-01-01T04:00:00.000Z", "Code Review", "In QA"),
      history("2026-01-01T05:00:00.000Z", "In QA", "Done"),
    ],
    QA,
    CTX
  );
  assert.equal(doc.qa_entries, 3);
  assert.equal(doc.qa_bounces, 2);
  assert.equal(doc.qa_bounced, true);
  assert.equal(doc.qa_end_status, "Done");
});

test("bounce after an apparent forward exit is still caught by the first exit rule", () => {
  // Old logic broke at first exit. New logic ends the cycle at the first
  // forward exit but still counts a bounce that happened before it.
  const doc = buildQaCycleDocument(
    issue,
    [
      history("2026-01-01T00:00:00.000Z", "In Progress", "Ready for Testing"),
      history("2026-01-01T01:00:00.000Z", "Ready for Testing", "In Progress"),
      history("2026-01-01T02:00:00.000Z", "In Progress", "In QA"),
      history("2026-01-01T03:00:00.000Z", "In QA", "Pending Release"),
    ],
    QA,
    CTX
  );
  assert.equal(doc.qa_entries, 2);
  assert.equal(doc.qa_bounces, 1);
  assert.equal(doc.qa_end_status, "Pending Release");
});

test("cancelled exit ends the cycle without counting as a bounce", () => {
  const doc = buildQaCycleDocument(
    issue,
    [
      history("2026-01-01T00:00:00.000Z", "In Progress", "In QA"),
      history("2026-01-02T00:00:00.000Z", "In QA", "Won't do"),
    ],
    QA,
    CTX
  );
  assert.equal(doc.qa_bounces, 0);
  assert.equal(doc.qa_bounced, false);
  assert.equal(doc.qa_end_status, "Won't do");
  assert.equal(doc.qa_open, false);
});

test("still in QA: entered but no exit yet", () => {
  const doc = buildQaCycleDocument(
    issue,
    [history("2026-01-02T00:00:00.000Z", "In Progress", "In QA")],
    QA,
    CTX
  );
  assert.equal(doc.qa_open, true);
  assert.equal(doc.qa_ended_at, null);
  assert.equal(doc.qa_cycle_seconds, null);
  assert.equal(doc.qa_entries, 1);
  assert.equal(doc.qa_bounces, 0);
});

test("never reached QA returns null", () => {
  const doc = buildQaCycleDocument(
    issue,
    [history("2026-01-02T00:00:00.000Z", "To Do", "Done")],
    QA,
    CTX
  );
  assert.equal(doc, null);
});

test("unsorted histories are ordered before the walk", () => {
  const doc = buildQaCycleDocument(
    issue,
    [
      history("2026-01-02T06:00:00.000Z", "In QA", "Passed QA"),
      history("2026-01-01T00:00:00.000Z", "In Progress", "In QA"),
    ],
    QA,
    CTX
  );
  assert.equal(doc.qa_started_at, "2026-01-01T00:00:00.000Z");
  assert.equal(doc.qa_end_status, "Passed QA");
});
