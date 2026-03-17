import test from "node:test";
import assert from "node:assert/strict";

import { createJiraClient } from "../src/jira-client.js";

test("createJiraClient requests current user with basic auth", async () => {
  let requestUrl;
  let requestHeaders;

  const client = createJiraClient(
    {
      baseUrl: "https://example.atlassian.net",
      email: "user@example.com",
      apiToken: "secret-token",
    },
    {
      fetchImpl: async (url, options) => {
        requestUrl = String(url);
        requestHeaders = options.headers;
        return {
          ok: true,
          async json() {
            return { displayName: "Example User" };
          },
        };
      },
    }
  );

  const user = await client.getCurrentUser();

  assert.equal(requestUrl, "https://example.atlassian.net/rest/api/3/myself");
  assert.equal(user.displayName, "Example User");
  assert.match(requestHeaders.Authorization, /^Basic /);
  assert.equal(requestHeaders.Accept, "application/json");
});

test("createJiraClient appends query parameters", async () => {
  let requestUrl;

  const client = createJiraClient(
    {
      baseUrl: "https://example.atlassian.net",
      email: "user@example.com",
      apiToken: "secret-token",
    },
    {
      fetchImpl: async (url) => {
        requestUrl = String(url);
        return {
          ok: true,
          async json() {
            return { issues: [] };
          },
        };
      },
    }
  );

  await client.getJson("/rest/api/3/search", {
    jql: "project = ENG",
    maxResults: 10,
  });

  assert.equal(
    requestUrl,
    "https://example.atlassian.net/rest/api/3/search?jql=project+%3D+ENG&maxResults=10"
  );
});

test("createJiraClient searchIssues applies configured project scope", async () => {
  let requestUrl;

  const client = createJiraClient(
    {
      baseUrl: "https://example.atlassian.net",
      email: "user@example.com",
      apiToken: "secret-token",
      projectKeys: ["ARCH", "ENG"],
    },
    {
      fetchImpl: async (url) => {
        requestUrl = String(url);
        return {
          ok: true,
          async json() {
            return { issues: [] };
          },
        };
      },
    }
  );

  await client.searchIssues({
    jql: "statusCategory != Done",
    maxResults: 10,
  });

  assert.equal(
    requestUrl,
    "https://example.atlassian.net/rest/api/3/search?jql=project+in+%28ARCH%2CENG%29+AND+%28statusCategory+%21%3D+Done%29&maxResults=10"
  );
});

test("createJiraClient surfaces non-200 responses", async () => {
  const client = createJiraClient(
    {
      baseUrl: "https://example.atlassian.net",
      email: "user@example.com",
      apiToken: "secret-token",
    },
    {
      fetchImpl: async () => ({
        ok: false,
        status: 401,
        async text() {
          return "Unauthorized";
        },
      }),
    }
  );

  await assert.rejects(
    () => client.getCurrentUser(),
    /Jira request failed with HTTP 401: Unauthorized/
  );
});
