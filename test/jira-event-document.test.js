import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCreatedEventDocument,
  buildHistoryEventDocuments,
  buildStatusCategoryById,
} from "../src/jira-event-document.js";

test("buildCreatedEventDocument creates a created event", () => {
  const doc = buildCreatedEventDocument(
    {
      id: "123",
      key: "ENG-1",
      fields: {
        created: "2026-03-17T10:00:00.000+0700",
        summary: "Example issue",
        issuetype: {
          id: "10001",
          name: "Story",
          subtask: false,
          hierarchyLevel: 0,
        },
        project: {
          key: "ENG",
          name: "Engineering",
        },
        creator: {
          accountId: "abc",
          displayName: "Alice",
          active: true,
          accountType: "atlassian",
        },
      },
    },
    { baseUrl: "https://example.atlassian.net" }
  );

  assert.equal(doc.id, "123:created");
  assert.equal(doc.event_type, "created");
  assert.equal(doc.issue_key, "ENG-1");
  assert.equal(doc.project_key, "ENG");
  assert.equal(doc.issue_type.name, "Story");
  assert.equal(doc.actor.display_name, "Alice");
});

test("buildStatusCategoryById maps status ids to categories", () => {
  const map = buildStatusCategoryById([
    {
      statuses: [
        { id: "10000", statusCategory: { key: "new" } },
        { id: "10001", statusCategory: { key: "done" } },
      ],
    },
  ]);

  assert.equal(map.get("10000"), "new");
  assert.equal(map.get("10001"), "done");
});

test("buildStatusCategoryById maps flat Jira status payloads", () => {
  const map = buildStatusCategoryById([
    { id: "3", statusCategory: { key: "indeterminate" } },
    { id: "10001", statusCategory: "DONE" },
  ]);

  assert.equal(map.get("3"), "indeterminate");
  assert.equal(map.get("10001"), "done");
});

test("buildHistoryEventDocuments emits updated and completed events separately", () => {
  const docs = buildHistoryEventDocuments(
    {
      id: "123",
      key: "ENG-1",
      fields: {
        summary: "Example issue",
        issuetype: {
          id: "10001",
          name: "Story",
          subtask: false,
          hierarchyLevel: 0,
        },
        project: {
          key: "ENG",
          name: "Engineering",
        },
      },
    },
    {
      id: "555",
      created: "2026-03-17T11:00:00.000+0700",
      author: {
        accountId: "abc",
        displayName: "Alice",
        active: true,
        accountType: "atlassian",
      },
      items: [
        {
          field: "status",
          fromString: "In Progress",
          to: "10001",
          toString: "Done",
        },
        {
          field: "assignee",
          fromString: "Alice",
          toString: "Bob",
        },
      ],
    },
    new Map([["10001", "done"]]),
    {
      baseUrl: "https://example.atlassian.net",
      storyPoints: 5,
      assigneeAtCompletion: {
        accountId: "def",
        displayName: "Bob",
        active: true,
        accountType: "atlassian",
      },
    }
  );

  assert.equal(docs.length, 2);
  assert.equal(docs[0].event_type, "updated");
  assert.equal(docs[1].event_type, "completed");
  assert.equal(docs[1].issue_type.name, "Story");
  assert.equal(docs[1].status_to, "Done");
  assert.equal(docs[1].status_to_category_key, "done");
  assert.equal(docs[1].story_points, 5);
  assert.deepEqual(docs[1].assignee_at_completion, {
    account_id: "def",
    display_name: "Bob",
    active: true,
    account_type: "atlassian",
  });
});
