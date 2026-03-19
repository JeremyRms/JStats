import test from "node:test";
import assert from "node:assert/strict";

import { buildJiraIssueDocument } from "../src/jira-issue-document.js";

test("buildJiraIssueDocument normalizes Jira issue fields", () => {
  const doc = buildJiraIssueDocument(
    {
      id: "123",
      key: "ENG-1",
      fields: {
        summary: "Example issue",
        created: "2026-03-17T10:00:00.000+0700",
        updated: "2026-03-17T11:00:00.000+0700",
        resolutiondate: null,
        project: {
          id: "10",
          key: "ENG",
          name: "Engineering",
          projectTypeKey: "software",
          simplified: false,
          projectCategory: { name: "Squads" },
        },
        issuetype: {
          id: "3",
          name: "Task",
          subtask: false,
          hierarchyLevel: 0,
        },
        status: {
          id: "10003",
          name: "In Progress",
          statusCategory: {
            key: "indeterminate",
            name: "In Progress",
          },
        },
        parent: {
          id: "122",
          key: "ENG-0",
          fields: {
            summary: "Parent issue",
            status: { name: "To Do" },
            issuetype: { name: "Epic" },
          },
        },
        assignee: {
          accountId: "abc",
          displayName: "Alice",
          active: true,
          accountType: "atlassian",
        },
        reporter: {
          accountId: "def",
          displayName: "Bob",
          active: true,
          accountType: "atlassian",
        },
        creator: {
          accountId: "ghi",
          displayName: "Carol",
          active: true,
          accountType: "atlassian",
        },
        customfield_10004: 8,
        labels: ["backend"],
        components: [{ name: "API" }],
        fixVersions: [{ name: "2026.03" }],
        comment: {
          total: 2,
        },
      },
    },
    {
      baseUrl: "https://example.atlassian.net",
    }
  );

  assert.equal(doc.id, "123");
  assert.equal(doc.key, "ENG-1");
  assert.equal(doc.jira_base_url, "https://example.atlassian.net");
  assert.equal(doc.entity_type, "jira_issue");
  assert.equal(doc.summary, "Example issue");
  assert.deepEqual(doc.project, {
    id: "10",
    key: "ENG",
    name: "Engineering",
    project_type_key: "software",
    simplified: false,
    category_name: "Squads",
  });
  assert.deepEqual(doc.issue_type, {
    id: "3",
    name: "Task",
    subtask: false,
    hierarchy_level: 0,
  });
  assert.deepEqual(doc.status, {
    id: "10003",
    name: "In Progress",
    category_key: "indeterminate",
    category_name: "In Progress",
  });
  assert.deepEqual(doc.parent, {
    id: "122",
    key: "ENG-0",
    summary: "Parent issue",
    status_name: "To Do",
    issue_type_name: "Epic",
  });
  assert.deepEqual(doc.assignee, {
    account_id: "abc",
    display_name: "Alice",
    active: true,
    account_type: "atlassian",
  });
  assert.deepEqual(doc.labels, ["backend"]);
  assert.deepEqual(doc.components, ["API"]);
  assert.deepEqual(doc.fix_versions, ["2026.03"]);
  assert.equal(doc.story_points, 8);
  assert.equal(doc.comment_count, 2);
  assert.ok(Number.isFinite(Date.parse(doc.ingested_at)));
});
