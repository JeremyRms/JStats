import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  buildMemberDocuments,
  buildTeamDocuments,
  loadTeamDirectory,
  normalizeTeamDirectory,
  resolveTeamDirectoryFile,
} from "../src/team-directory.js";

test("resolveTeamDirectoryFile falls back to the tracked config file", () => {
  assert.equal(resolveTeamDirectoryFile({}), "config/team-directory.json");
});

test("normalizeTeamDirectory validates members against known teams", () => {
  const directory = normalizeTeamDirectory({
    version: 1,
    teams: [
      {
        key: "BROK",
        name: "Broker",
        jira_project_key: "BROK",
      },
    ],
    members: [
      {
        key: "jeremy",
        team_key: "BROK",
        full_name: "Jeremy Lamit",
        nickname: "Jeremy",
        github_login: "jeremyrms",
        jira_account_id: "jira-123",
        jira_display_name: "Jeremy Lamit",
      },
    ],
  });

  assert.equal(directory.teams[0].active, true);
  assert.equal(directory.members[0].active, true);
});

test("normalizeTeamDirectory rejects duplicate github logins", () => {
  assert.throws(
    () =>
      normalizeTeamDirectory({
        teams: [
          {
            key: "MAR",
            name: "Marketplace",
            jira_project_key: "MAR",
          },
        ],
        members: [
          {
            key: "member-one",
            team_key: "MAR",
            full_name: "Member One",
            nickname: "One",
            github_login: "shared-login",
            jira_account_id: "jira-1",
            jira_display_name: "Member One",
          },
          {
            key: "member-two",
            team_key: "MAR",
            full_name: "Member Two",
            nickname: "Two",
            github_login: "shared-login",
            jira_account_id: "jira-2",
            jira_display_name: "Member Two",
          },
        ],
      }),
    /Duplicate github_login shared-login/
  );
});

test("buildTeamDocuments and buildMemberDocuments flatten shared fields", () => {
  const directory = normalizeTeamDirectory({
    teams: [
      {
        key: "MAR",
        name: "Marketplace",
        jira_project_key: "MAR",
      },
    ],
    members: [
      {
        key: "member-one",
        team_key: "MAR",
        full_name: "Member One",
        nickname: "One",
        github_login: "member-one",
        jira_account_id: "jira-1",
        jira_display_name: "Member One",
      },
    ],
  });

  const teams = buildTeamDocuments(directory);
  const members = buildMemberDocuments(directory);

  assert.equal(teams[0].id, "team:MAR");
  assert.equal(teams[0].jira_project_key, "MAR");
  assert.equal(members[0].id, "member:member-one");
  assert.equal(members[0].team_name, "Marketplace");
  assert.equal(members[0].jira_project_key, "MAR");
});

test("loadTeamDirectory reads the json file from disk", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "team-directory-"));
  const filePath = path.join(tempDir, "team-directory.json");
  fs.writeFileSync(
    filePath,
    JSON.stringify({
      teams: [
        {
          key: "BROK",
          name: "Broker",
          jira_project_key: "BROK",
        },
      ],
      members: [
        {
          key: "member-one",
          team_key: "BROK",
          full_name: "Member One",
          nickname: "One",
          github_login: "member-one",
          jira_account_id: "jira-1",
          jira_display_name: "Member One",
        },
      ],
    })
  );

  const directory = loadTeamDirectory(filePath);

  assert.equal(directory.teams[0].key, "BROK");
  assert.equal(directory.members[0].jira_account_id, "jira-1");
});
