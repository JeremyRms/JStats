import { buildJiraBasicAuthHeader, buildScopedJql } from "./jira-config.js";

export function createJiraClient(config, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const defaultHeaders = {
    Accept: "application/json",
    Authorization: buildJiraBasicAuthHeader(config),
  };

  return {
    async getCurrentUser() {
      return requestJson("/rest/api/3/myself");
    },

    async getJson(pathname, searchParams) {
      return requestJson(pathname, searchParams);
    },

    async getIssue(issueKey, options = {}) {
      return requestJson(`/rest/api/3/issue/${issueKey}`, options);
    },

    async getIssueChangelog(issueKey, options = {}) {
      return requestJson(`/rest/api/3/issue/${issueKey}/changelog`, options);
    },

    async listStatuses() {
      return requestJson("/rest/api/3/status");
    },

    async searchIssues(options = {}) {
      return requestJson("/rest/api/3/search/jql", {
        ...options,
        startAt: undefined,
        jql: buildScopedJql(config.projectKeys, options.jql || ""),
      });
    },
  };

  async function requestJson(pathname, searchParams) {
    const url = new URL(pathname, `${config.baseUrl}/`);
    if (searchParams) {
      for (const [key, value] of Object.entries(searchParams)) {
        if (value !== undefined && value !== null && value !== "") {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const response = await fetchImpl(url, {
      headers: defaultHeaders,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Jira request failed with HTTP ${response.status}${
          body ? `: ${body}` : ""
        }`
      );
    }

    return response.json();
  }
}
