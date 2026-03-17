export function resolveJiraAuthConfig(env = process.env) {
  const baseUrl = normalizeBaseUrl(env.JIRA_BASE_URL);
  const email = env.JIRA_EMAIL?.trim();
  const apiToken = env.JIRA_API_TOKEN?.trim();
  const projectKeys = parseProjectKeys(env.JIRA_PROJECT_KEYS);

  const missing = [];
  if (!baseUrl) {
    missing.push("JIRA_BASE_URL");
  }
  if (!email) {
    missing.push("JIRA_EMAIL");
  }
  if (!apiToken) {
    missing.push("JIRA_API_TOKEN");
  }

  if (missing.length > 0) {
    throw new Error(`Missing Jira configuration: ${missing.join(", ")}`);
  }

  return {
    baseUrl,
    email,
    apiToken,
    projectKeys,
  };
}

export function buildJiraBasicAuthHeader({ email, apiToken }) {
  return `Basic ${Buffer.from(`${email}:${apiToken}`).toString("base64")}`;
}

export function buildScopedJql(projectKeys = [], jql = "") {
  const scope = projectKeys.length
    ? `project in (${projectKeys.join(",")})`
    : "";
  const filter = jql.trim();

  if (scope && filter) {
    return `${scope} AND (${filter})`;
  }

  return scope || filter;
}

function normalizeBaseUrl(baseUrl) {
  const value = baseUrl?.trim();
  if (!value) {
    return "";
  }

  return value.replace(/\/+$/, "");
}

function parseProjectKeys(projectKeys) {
  if (!projectKeys) {
    return [];
  }

  return projectKeys
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}
