import * as fs from "fs";
import * as path from "path";

const DEFAULT_TEAM_DIRECTORY_FILE = "config/team-directory.json";

export function resolveTeamDirectoryFile(env = process.env) {
  return env.TEAM_DIRECTORY_FILE || DEFAULT_TEAM_DIRECTORY_FILE;
}

export function loadTeamDirectory(filePath = resolveTeamDirectoryFile()) {
  const resolvedPath = path.resolve(filePath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Team directory file not found: ${resolvedPath}`);
  }

  const payload = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
  return normalizeTeamDirectory(payload, { filePath: resolvedPath });
}

export function normalizeTeamDirectory(payload = {}, context = {}) {
  const teams = Array.isArray(payload.teams) ? payload.teams : [];
  const members = Array.isArray(payload.members) ? payload.members : [];
  const normalized = {
    version: payload.version || 1,
    teams: teams.map(normalizeTeam),
    members: members.map(normalizeMember),
  };

  validateTeamDirectory(normalized, context);
  return normalized;
}

export function buildTeamDocuments(directory) {
  return directory.teams.map((team) => ({
    id: team.id || `team:${team.key}`,
    entity_type: "team_directory_team",
    source: "team_directory",
    team_key: team.key,
    team_name: team.name,
    jira_project_key: team.jira_project_key,
    active: team.active,
    ingested_at: new Date().toISOString(),
  }));
}

export function buildMemberDocuments(directory) {
  const teamByKey = new Map(directory.teams.map((team) => [team.key, team]));

  return directory.members.map((member) => {
    const team = teamByKey.get(member.team_key);

    return {
      id: member.id || `member:${member.key}`,
      entity_type: "team_directory_member",
      source: "team_directory",
      member_key: member.key,
      team_key: member.team_key,
      team_name: team?.name || null,
      jira_project_key: team?.jira_project_key || null,
      full_name: member.full_name,
      nickname: member.nickname,
      github_login: member.github_login,
      jira_account_id: member.jira_account_id,
      jira_display_name: member.jira_display_name,
      active: member.active,
      ingested_at: new Date().toISOString(),
    };
  });
}

function normalizeTeam(team = {}) {
  return {
    id: normalizeOptionalString(team.id),
    key: requireNonEmptyString(team.key, "team.key"),
    name: requireNonEmptyString(team.name, `team ${team.key || "<unknown>"} name`),
    jira_project_key: requireNonEmptyString(
      team.jira_project_key,
      `team ${team.key || "<unknown>"} jira_project_key`
    ),
    active: normalizeBoolean(team.active, true),
  };
}

function normalizeMember(member = {}) {
  return {
    id: normalizeOptionalString(member.id),
    key: requireNonEmptyString(member.key, "member.key"),
    team_key: requireNonEmptyString(
      member.team_key,
      `member ${member.key || "<unknown>"} team_key`
    ),
    full_name: requireNonEmptyString(
      member.full_name,
      `member ${member.key || "<unknown>"} full_name`
    ),
    nickname: requireNonEmptyString(
      member.nickname,
      `member ${member.key || "<unknown>"} nickname`
    ),
    github_login: requireNonEmptyString(
      member.github_login,
      `member ${member.key || "<unknown>"} github_login`
    ),
    jira_account_id: requireNonEmptyString(
      member.jira_account_id,
      `member ${member.key || "<unknown>"} jira_account_id`
    ),
    jira_display_name: requireNonEmptyString(
      member.jira_display_name,
      `member ${member.key || "<unknown>"} jira_display_name`
    ),
    active: normalizeBoolean(member.active, true),
  };
}

function validateTeamDirectory(directory, context = {}) {
  const source = context.filePath ? ` in ${context.filePath}` : "";
  const teamKeys = new Set();
  const memberKeys = new Set();
  const githubLogins = new Set();
  const jiraAccountIds = new Set();

  for (const team of directory.teams) {
    if (teamKeys.has(team.key)) {
      throw new Error(`Duplicate team key ${team.key}${source}`);
    }
    teamKeys.add(team.key);
  }

  for (const member of directory.members) {
    if (!teamKeys.has(member.team_key)) {
      throw new Error(
        `Unknown team_key ${member.team_key} for member ${member.key}${source}`
      );
    }
    if (memberKeys.has(member.key)) {
      throw new Error(`Duplicate member key ${member.key}${source}`);
    }
    if (githubLogins.has(member.github_login)) {
      throw new Error(`Duplicate github_login ${member.github_login}${source}`);
    }
    if (jiraAccountIds.has(member.jira_account_id)) {
      throw new Error(
        `Duplicate jira_account_id ${member.jira_account_id}${source}`
      );
    }

    memberKeys.add(member.key);
    githubLogins.add(member.github_login);
    jiraAccountIds.add(member.jira_account_id);
  }
}

function requireNonEmptyString(value, label) {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    throw new Error(`Missing required ${label}`);
  }
  return normalized;
}

function normalizeOptionalString(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized || null;
}

function normalizeBoolean(value, fallback) {
  if (value === undefined || value === null) {
    return fallback;
  }

  return Boolean(value);
}
