import http from "http";
import pkg from "octokit";
import elastic from "@elastic/elasticsearch";
import pkgthrottling from "@octokit/plugin-throttling";
import dotenv from "dotenv";
import * as fs from "fs";
import { enrichDocument } from "./src/document-enrichment.js";
import {
  getRepoPullWatermark,
  loadState,
  saveState,
  setRepoPullWatermark,
} from "./src/state-store.js";
const { Octokit } = pkg;
const { throttling } = pkgthrottling;

dotenv.config();
const minimumRateLimitRetryAfterSeconds = 30;
const rateLimitResetBufferSeconds = parsePositiveInteger(
  process.env.RATE_LIMIT_RESET_BUFFER_SECONDS,
  5
);
const rateLimitRecoveryRetries = parsePositiveInteger(
  process.env.RATE_LIMIT_RECOVERY_RETRIES,
  4
);

const server = http.createServer((request, response) => {
  response.statusCode = 200;
  response.setHeader("Content-Type", "text/plain");
  response.end();
});

const JStatsOctokit = Octokit.plugin(throttling);

const octokit = new JStatsOctokit({
  auth: `${process.env.API_KEY}`,
  userAgent: "JStats v0.2",
  timeZone: `${process.env.TIMEZONE}`,
  log: {
    debug: () => {},
    info: () => {},
    warn: (message) => logNotice(String(message)),
    error: console.error,
  },
  throttle: {
    onRateLimit: async (retryAfter, options) => {
      logNotice(
        `Request quota exhausted for request ${options.method} ${options.url}`
      );

      // Retry twice after hitting a rate limit error, then give up
      if (options.request.retryCount <= 2) {
        const waitSeconds = Math.max(
          retryAfter,
          minimumRateLimitRetryAfterSeconds
        );
        const additionalDelaySeconds = Math.max(waitSeconds - retryAfter, 0);
        if (additionalDelaySeconds > 0) {
          await sleep(additionalDelaySeconds * 1000);
        }
        logNotice(`Retrying after ${waitSeconds} seconds due to rate limit`);
        return true;
      }
    },
    onAbuseLimit: (retryAfter, options) => {
      // does not retry, only logs a warning
      logNotice(
        `Abuse detected for request ${options.method} ${options.url}`
      );
    },
  },
});

await runGithubCallWithRateLimitRecovery("users.getAuthenticated", () =>
  octokit.rest.users.getAuthenticated()
).then(({ data }) => {
  console.info(`Hello`, data.login);
});

const { Client } = elastic;
const ElasticClient = new Client({
  node: `${process.env.ELASTIC_ENDPOINT}:${process.env.ELASTIC_PORT}`,
  auth: {
    username: "elastic",
    password: `${process.env.ELASTIC_PASSWORD}`,
  },
  ssl: {
    ca: fs.readFileSync("/certs/ca/ca.crt"),
    rejectUnauthorized: false,
  },
});

const stateFilePath = process.env.STATE_FILE || "./.jstats-state.json";
const minPullUpdatedAt =
  process.env.MIN_PULL_UPDATED_AT || "2025-01-01T00:00:00Z";
const ingestionState = loadState(stateFilePath);
ingestionState.last_run_started_at = new Date().toISOString();
console.info(`Using state file ${stateFilePath}`);
console.info(`Minimum pull updated_at is ${minPullUpdatedAt}`);

// cleaning up before to start
// ElasticClient.indices.delete({
//     index: '*'
// })

let repoCount;
let pullCount = 0;
let reviewCount = 0;
let commentCount = 0;
let membersCount = 0;
let teamsCount = 0;
let newestPullUpdatedAtInRun = null;
let oldestPullUpdatedAtInRun = null;
const indexingProgress = createProgressTracker();
const prConcurrency = parsePositiveInteger(process.env.PR_CONCURRENCY, 4);
console.info(`PR concurrency is ${prConcurrency}`);

const members = await runGithubCallWithRateLimitRecovery(
  "orgs.listMembers",
  () =>
    octokit.paginate(
      octokit.rest.orgs.listMembers,
      {
        org: `${process.env.ORGANIZATION}`,
      },
      (response) => response.data
    )
);
membersCount = members.length;
console.info(membersCount, ` members found`);
addPlanned(indexingProgress, members.length, "members");

for (const member of members) {
  enrichDocument(member, {
    organization: `${process.env.ORGANIZATION}`,
    entityType: "member",
  });
  cleanMember(member);

  await indexDocument(ElasticClient, {
    id: member.id,
    index: "jstats-member",
    body: member,
  }, indexingProgress);
}

const repos = await runGithubCallWithRateLimitRecovery("repos.listForOrg", () =>
  octokit.paginate(
    octokit.rest.repos.listForOrg,
    {
      org: `${process.env.ORGANIZATION}`,
      type: "private",
      sort: "updated",
      direction: "desc",
      per_page: 100,
      state: "all",
    },
    (response) => response.data
      )
);

const nonArchivedRepos = repos.filter((repository) => !repository.archived);
const archivedRepoCount = repos.length - nonArchivedRepos.length;

repoCount = nonArchivedRepos.length;
logInfoWithProgress(
  indexingProgress,
  `${repoCount} non-archived repos found`
);
if (archivedRepoCount > 0) {
  logInfoWithProgress(
    indexingProgress,
    `skipping ${archivedRepoCount} archived repos`
  );
}
addPlanned(indexingProgress, nonArchivedRepos.length, "repositories");

for (const repository of nonArchivedRepos) {
  logInfoWithProgress(
    indexingProgress,
    `pulling data for repository: ${repository.name}`
  );
  const pullWatermark = getRepoPullWatermark(ingestionState, repository.name);
  let latestPullUpdatedAt = pullWatermark;
  let newestPullUpdatedAtInRepo = null;
  let oldestPullUpdatedAtInRepo = null;

  if (pullWatermark) {
    logInfoWithProgress(
      indexingProgress,
      `incremental pull sync from ${pullWatermark}`
    );
  }
  logInfoWithProgress(
    indexingProgress,
    `ignoring pull updates older than ${minPullUpdatedAt}`
  );

  enrichDocument(repository, {
    organization: `${process.env.ORGANIZATION}`,
    repository: repository.name,
    entityType: "repository",
  });
  cleanRepo(repository);

  await indexDocument(ElasticClient, {
    id: repository.id,
    index: "jstats-repository",
    body: repository,
  }, indexingProgress);

  const teams = await runGithubCallWithRateLimitRecovery(
    `repos.listTeams ${repository.name}`,
    () =>
      octokit.paginate(
        octokit.rest.repos.listTeams,
        {
          owner: `${process.env.ORGANIZATION}`,
          repo: repository.name,
        },
        (response) => response.data
      )
  );

  teamsCount = teams.length;
  logInfoWithProgress(
    indexingProgress,
    `${teamsCount} teams found for repo ${repository.name}`
  );
  addPlanned(indexingProgress, teams.length, `teams in ${repository.name}`);

  for (const team of teams) {
    enrichDocument(team, {
      organization: `${process.env.ORGANIZATION}`,
      repository: repository.name,
      entityType: "team",
    });
    cleanTeam(team);

    await indexDocument(ElasticClient, {
      id: team.id,
      index: "jstats-teams",
      body: team,
    }, indexingProgress);
  }

  const pullRequests = await runGithubCallWithRateLimitRecovery(
    `pulls.list ${repository.name}`,
    () =>
      octokit.paginate(
        octokit.rest.pulls.list,
        {
          owner: `${process.env.ORGANIZATION}`,
          repo: repository.name,
          state: "all",
          sort: "updated",
          direction: "desc",
          per_page: 100,
        },
        (response, done) => {
          const nextPullRequests = [];

          for (const pullRequest of response.data) {
            if (pullRequest.updated_at < minPullUpdatedAt) {
              done();
              break;
            }

            if (pullWatermark && pullRequest.updated_at <= pullWatermark) {
              done();
              break;
            }

            nextPullRequests.push(pullRequest);
          }

          return nextPullRequests;
        }
      )
  );
  pullRequests.sort(
    (left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at)
  );

  if (pullRequests.length) {
    pullCount += pullRequests.length;
    const newestPullInBatch = pullRequests[0]?.updated_at;
    const oldestPullInBatch = pullRequests[pullRequests.length - 1]?.updated_at;
    logInfoWithProgress(
      indexingProgress,
      `[repo:${repository.name}] pull requests in scope: ${pullRequests.length} (run total: ${pullCount}, newest=${newestPullInBatch}, oldest=${oldestPullInBatch})`
    );
  }
  addPlanned(
    indexingProgress,
    pullRequests.length,
    `pull requests in ${repository.name}`
  );

  await mapWithConcurrency(pullRequests, prConcurrency, async (pullRequest) => {
    if (
      !newestPullUpdatedAtInRepo ||
      isLaterTimestamp(pullRequest.updated_at, newestPullUpdatedAtInRepo)
    ) {
      newestPullUpdatedAtInRepo = pullRequest.updated_at;
    }
    if (
      !oldestPullUpdatedAtInRepo ||
      isEarlierTimestamp(pullRequest.updated_at, oldestPullUpdatedAtInRepo)
    ) {
      oldestPullUpdatedAtInRepo = pullRequest.updated_at;
    }

    if (!latestPullUpdatedAt || pullRequest.updated_at > latestPullUpdatedAt) {
      latestPullUpdatedAt = pullRequest.updated_at;
    }

    const [prDiff, reviews, comments] = await Promise.all([
      runGithubCallWithRateLimitRecovery(
        `pulls.get ${repository.name}#${pullRequest.number}`,
        () =>
          octokit.rest.pulls.get({
            owner: `${process.env.ORGANIZATION}`,
            repo: repository.name,
            pull_number: pullRequest.number,
          })
      ),
      runGithubCallWithRateLimitRecovery(
        `pulls.listReviews ${repository.name}#${pullRequest.number}`,
        () =>
          octokit.paginate(
            octokit.rest.pulls.listReviews,
            {
              owner: `${process.env.ORGANIZATION}`,
              repo: repository.name,
              pull_number: pullRequest.number,
              per_page: 100,
            },
            (response) => response.data
          )
      ),
      runGithubCallWithRateLimitRecovery(
        `pulls.listReviewComments ${repository.name}#${pullRequest.number}`,
        () =>
          octokit.paginate(
            octokit.rest.pulls.listReviewComments,
            {
              owner: `${process.env.ORGANIZATION}`,
              repo: repository.name,
              pull_number: pullRequest.number,
              per_page: 100,
            },
            (response) => response.data
          )
      ),
    ]);

    pullRequest["diff"] = prDiff?.["data"];

    enrichDocument(pullRequest, {
      organization: `${process.env.ORGANIZATION}`,
      repository: repository.name,
      entityType: "pull_request",
      pullRequestId: pullRequest.id,
      pullRequestNumber: pullRequest.number,
    });

    cleanPR(pullRequest);

    await indexDocument(
      ElasticClient,
      {
        id: pullRequest.id,
        index: "jstats-pullrequest",
        body: pullRequest,
      },
      indexingProgress
    );

    if (reviews.length) {
      reviewCount += reviews.length;
      logInfoWithProgress(
        indexingProgress,
        `[repo:${repository.name}] [pr:${pullRequest.number}] reviews for this PR: ${reviews.length} (run total: ${reviewCount})`
      );
    }
    addPlanned(
      indexingProgress,
      reviews.length,
      `reviews in ${repository.name}#${pullRequest.number}`
    );

    for (const review of reviews) {
      enrichDocument(review, {
        organization: `${process.env.ORGANIZATION}`,
        repository: repository.name,
        entityType: "review",
        pullRequestId: pullRequest.id,
        pullRequestNumber: pullRequest.number,
      });
      cleanReview(review);

      await indexDocument(
        ElasticClient,
        {
          id: review.id,
          index: "jstats-review",
          body: review,
        },
        indexingProgress
      );
    }

    if (comments.length) {
      commentCount += comments.length;
      logInfoWithProgress(
        indexingProgress,
        `[repo:${repository.name}] [pr:${pullRequest.number}] review comments for this PR: ${comments.length} (run total: ${commentCount})`
      );
    }
    addPlanned(
      indexingProgress,
      comments.length,
      `review comments in ${repository.name}#${pullRequest.number}`
    );

    for (const comment of comments) {
      enrichDocument(comment, {
        organization: `${process.env.ORGANIZATION}`,
        repository: repository.name,
        entityType: "review_comment",
        pullRequestId: pullRequest.id,
        pullRequestNumber: pullRequest.number,
      });
      cleanComment(comment);

      await indexDocument(
        ElasticClient,
        {
          id: comment.id,
          index: "jstats-comment",
          body: comment,
        },
        indexingProgress
      );
    }
  });

  if (newestPullUpdatedAtInRepo && oldestPullUpdatedAtInRepo) {
    if (
      !newestPullUpdatedAtInRun ||
      isLaterTimestamp(newestPullUpdatedAtInRepo, newestPullUpdatedAtInRun)
    ) {
      newestPullUpdatedAtInRun = newestPullUpdatedAtInRepo;
    }
    if (
      !oldestPullUpdatedAtInRun ||
      isEarlierTimestamp(oldestPullUpdatedAtInRepo, oldestPullUpdatedAtInRun)
    ) {
      oldestPullUpdatedAtInRun = oldestPullUpdatedAtInRepo;
    }

    logInfoWithProgress(
      indexingProgress,
      `[repo:${repository.name}] pull updated_at window in this run: newest=${newestPullUpdatedAtInRepo}, oldest=${oldestPullUpdatedAtInRepo}`
    );
  }

  if (latestPullUpdatedAt) {
    setRepoPullWatermark(ingestionState, repository.name, latestPullUpdatedAt);
    saveState(stateFilePath, ingestionState);
  }
}

logInfoWithProgress(indexingProgress, `${pullCount} pulls found`);
logInfoWithProgress(indexingProgress, `${reviewCount} reviews found`);
logInfoWithProgress(indexingProgress, `${commentCount} review comments found`);
if (newestPullUpdatedAtInRun && oldestPullUpdatedAtInRun) {
  logInfoWithProgress(
    indexingProgress,
    `pull updated_at window processed this run: newest=${newestPullUpdatedAtInRun}, oldest=${oldestPullUpdatedAtInRun}`
  );
  logInfoWithProgress(
    indexingProgress,
    `last pull data processed in this run (antechronological traversal): ${oldestPullUpdatedAtInRun}`
  );
} else {
  logInfoWithProgress(indexingProgress, "no pull requests processed in this run");
}
if (indexingProgress.indexed < indexingProgress.planned) {
  reportProgress(indexingProgress);
}
logInfoWithProgress(
  indexingProgress,
  `indexing complete: ${indexingProgress.indexed}/${indexingProgress.planned} documents indexed`
);
flushProgressLine(indexingProgress);

ingestionState.last_run_completed_at = new Date().toISOString();
saveState(stateFilePath, ingestionState);

let port = process.env.PORT;
let hostname = process.env.HOSTNAME;

server.listen(port, hostname, () => {
  console.log(`Server running at http://${hostname}:${port}/`);
});

function cleanComment(comment) {
  delete comment?.["_links"];
  delete comment?.["diff_hunk"];
  delete comment?.["html_url"];
  delete comment?.["line"];
  delete comment?.["node_id"];
  delete comment?.["original_line"];
  delete comment?.["original_position"];
  delete comment?.["original_start_line"];
  delete comment?.["position"];
  delete comment?.["pull_request_url"];
  delete comment?.["reactions"];
  delete comment?.["side"];
  delete comment?.["start_line"];
  delete comment?.["start_side"];
  delete comment?.["user"]?.["gravatar_id"];
  delete comment?.["user"]?.["node_id"];
  delete comment?.["user"]?.["site_admin"];
  delete comment?.["user"]?.["type"];
  delete comment?.["user"]?.["url"];

  for (const key in comment?.["user"]) {
    if (key.search(/_url/) != -1) {
      delete comment?.["user"][key];
    }
  }
}

function cleanReview(review) {
  delete review?.["node_id"];
  delete review?.["_links"];
  delete review?.["user"]?.["gravatar_id"];
  delete review?.["user"]?.["node_id"];
  delete review?.["user"]?.["type"];

  for (const key in review?.["user"]) {
    if (key.search(/_url/) != -1) {
      delete review?.["user"][key];
    }
  }
}

function cleanRepo(repository) {
  delete repository?.["fork"];
  delete repository?.["node_id"];
  delete repository?.["size"];
  delete repository?.["stargazers_count"];
  delete repository?.["watchers"];
  delete repository?.["watchers_count"];

  delete repository?.["owner"]?.["gravatar_id"];
  delete repository?.["owner"]?.["node_id"];
  delete repository?.["owner"]?.["url"];

  for (const key in repository) {
    if (key.search(/_url/) != -1) {
      delete repository[key];
    }
  }

  for (const key in repository?.["owner"]) {
    if (key.search(/_url/) != -1) {
      delete repository?.["owner"][key];
    }
  }
}

function cleanPR(pullRequest) {
  delete pullRequest?.["_links"];
  delete pullRequest?.["active_lock_reason"];
  delete pullRequest?.["diff_url"];
  delete pullRequest?.["merge_commit_sha"];
  delete pullRequest?.["node_id"];

  delete pullRequest?.["base"]?.["repo"];
  delete pullRequest?.["base"]?.["user"];

  delete pullRequest?.["head"]?.["repo"]?.["allow_forking"];
  delete pullRequest?.["head"]?.["repo"]?.["archived"];
  delete pullRequest?.["head"]?.["repo"]?.["created_at"];
  delete pullRequest?.["head"]?.["repo"]?.["disabled"];
  delete pullRequest?.["head"]?.["repo"]?.["fork"];
  delete pullRequest?.["head"]?.["repo"]?.["forks"];
  delete pullRequest?.["head"]?.["repo"]?.["forks_count"];
  delete pullRequest?.["head"]?.["repo"]?.["homepage"];
  delete pullRequest?.["head"]?.["repo"]?.["pushed_at"];
  delete pullRequest?.["head"]?.["repo"]?.["has_issues"];
  delete pullRequest?.["head"]?.["repo"]?.["has_projects"];
  delete pullRequest?.["head"]?.["repo"]?.["has_downloads"];
  delete pullRequest?.["head"]?.["repo"]?.["has_wiki"];
  delete pullRequest?.["head"]?.["repo"]?.["has_pages"];
  delete pullRequest?.["head"]?.["repo"]?.["is_template"];
  delete pullRequest?.["head"]?.["repo"]?.["license"];
  delete pullRequest?.["head"]?.["repo"]?.["node_id"];
  delete pullRequest?.["head"]?.["repo"]?.["open_issues"];
  delete pullRequest?.["head"]?.["repo"]?.["open_issues_count"];
  delete pullRequest?.["head"]?.["repo"]?.["owner"];
  delete pullRequest?.["head"]?.["repo"]?.["size"];
  delete pullRequest?.["head"]?.["repo"]?.["stargazers_count"];
  delete pullRequest?.["head"]?.["repo"]?.["topics"];
  delete pullRequest?.["head"]?.["repo"]?.["updated_at"];
  delete pullRequest?.["head"]?.["repo"]?.["visibility"];
  delete pullRequest?.["head"]?.["repo"]?.["watchers"];
  delete pullRequest?.["head"]?.["repo"]?.["watchers_count"];
  delete pullRequest?.["head"]?.["sha"];
  delete pullRequest?.["head"]?.["user"];

  delete pullRequest?.["user"]?.["gravatar_id"];
  delete pullRequest?.["user"]?.["node_id"];
  delete pullRequest?.["user"]?.["type"];

  delete pullRequest?.["assignee"]?.["gravatar_id"];
  delete pullRequest?.["assignee"]?.["node_id"];
  delete pullRequest?.["assignee"]?.["type"];

  delete pullRequest["diff"]?.["_links"];
  delete pullRequest["diff"]?.["active_lock_reason"];
  delete pullRequest["diff"]?.["diff_url"];
  delete pullRequest["diff"]?.["merge_commit_sha"];
  delete pullRequest["diff"]?.["node_id"];

  for (const key in pullRequest) {
    if (key.search(/_url/) != -1) {
      delete pullRequest[key];
    }
  }

  for (const key in pullRequest?.["user"]) {
    if (key.search(/_url/) != -1) {
      delete pullRequest?.["user"][key];
    }
  }

  for (const key in pullRequest?.["assignee"]) {
    if (key.search(/_url/) != -1) {
      delete pullRequest?.["assignee"][key];
    }
  }

  for (const assignee in pullRequest?.["assignees"]) {
    for (const key in pullRequest?.["assignees"][assignee]) {
      if (key.search(/_url/) != -1) {
        delete pullRequest?.["assignees"][assignee][key];
      }

      delete pullRequest?.["assignees"][assignee]?.["gravatar_id"];
      delete pullRequest?.["assignees"][assignee]?.["node_id"];
      delete pullRequest?.["assignees"][assignee]?.["type"];
    }
  }

  for (const reviewer in pullRequest?.["requested_reviewers"]) {
    for (const key in pullRequest?.["requested_reviewers"][reviewer]) {
      if (key.search(/_url/) != -1) {
        delete pullRequest?.["requested_reviewers"][reviewer][key];
      }

      delete pullRequest?.["requested_reviewers"][reviewer]?.["gravatar_id"];
      delete pullRequest?.["requested_reviewers"][reviewer]?.["node_id"];
      delete pullRequest?.["requested_reviewers"][reviewer]?.["type"];
    }
  }

  for (const key in pullRequest?.["head"]?.["repo"]) {
    if (key.search(/_url/) != -1) {
      delete pullRequest?.["head"]?.["repo"][key];
    }
  }

  for (const key in pullRequest){
    delete pullRequest["diff"]?.[key];
  }
  for (const key in pullRequest["diff"]) {
    if (key.search(/_url/) != -1) {
      delete pullRequest["diff"][key];
    }
  }
  for (const key in pullRequest["diff"]?.["merged_by"]) {
    if (key.search(/_url/) != -1) {
      delete pullRequest["diff"]["merged_by"][key];
    }
  }
}


function cleanMember(member) {
  delete member?.["node_id"];

  for (const key in member) {
    if (key.search(/_url/) != -1) {
      delete member[key];
    }
  }
}

function cleanTeam(team) {
  delete team?.["node_id"];

  for (const key in team) {
    if (key.search(/_url/) != -1) {
      delete team[key];
    }
  }
}

function createProgressTracker() {
  return {
    planned: 0,
    indexed: 0,
    width: 30,
    lastLoggedIndexed: -1,
    latestMessage: "",
    lastLineLength: 0,
  };
}

function addPlanned(progress, count, label) {
  if (!count) {
    return;
  }

  progress.planned += count;
}

async function indexDocument(client, params, progress) {
  await client.index(params);
  progress.indexed += 1;
  reportProgress(progress);
}

function reportProgress(progress, context) {
  if (context) {
    progress.latestMessage = context;
  }

  const total = progress.planned;
  const done = progress.indexed;
  const ratio = total > 0 ? Math.min(done / total, 1) : 0;
  const percent = total > 0 ? Math.floor(ratio * 100) : 0;
  const filled = Math.round(ratio * progress.width);
  const bar = `${"=".repeat(filled)}${"-".repeat(progress.width - filled)}`;
  const detail = context || progress.latestMessage;
  const line = `[${bar}] ${percent}% ${done}/${total} docs indexed${
    detail ? ` | ${detail}` : ""
  }`;

  if (process.stdout.isTTY) {
    const suffix = " ".repeat(Math.max(progress.lastLineLength - line.length, 0));
    process.stdout.write(`\r${line}${suffix}`);
    progress.lastLineLength = line.length;
    if (total > 0 && done >= total) {
      process.stdout.write("\n");
      progress.lastLineLength = 0;
    }
    return;
  }

  const shouldLog =
    Boolean(context) ||
    done === total ||
    done - progress.lastLoggedIndexed >= 50;

  if (shouldLog) {
    console.info(line);
    progress.lastLoggedIndexed = done;
  }
}

function logInfoWithProgress(progress, message) {
  if (process.stdout.isTTY) {
    reportProgress(progress, message);
    return;
  }
  console.info(message);
}

function flushProgressLine(progress) {
  if (process.stdout.isTTY && progress.lastLineLength > 0) {
    process.stdout.write("\n");
    progress.lastLineLength = 0;
  }
}

function isLaterTimestamp(left, right) {
  return Date.parse(left) > Date.parse(right);
}

function isEarlierTimestamp(left, right) {
  return Date.parse(left) < Date.parse(right);
}

function sleep(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function logNotice(message) {
  if (process.stdout.isTTY) {
    process.stdout.write(`\n${message}\n`);
    return;
  }
  console.info(message);
}

function isGithubRateLimitError(error) {
  if (error?.status !== 403) {
    return false;
  }

  const remaining = error?.response?.headers?.["x-ratelimit-remaining"];
  if (remaining === "0") {
    return true;
  }

  return /\brate limit exceeded\b/i.test(error?.message || "");
}

function getRateLimitRetryAfterSeconds(error) {
  const retryAfterHeader = parsePositiveInteger(
    error?.response?.headers?.["retry-after"],
    0
  );
  if (retryAfterHeader > 0) {
    return Math.max(retryAfterHeader, minimumRateLimitRetryAfterSeconds);
  }

  const resetEpochSeconds = parsePositiveInteger(
    error?.response?.headers?.["x-ratelimit-reset"],
    0
  );
  if (resetEpochSeconds > 0) {
    const secondsUntilReset = Math.max(
      Math.ceil(resetEpochSeconds - Date.now() / 1000),
      0
    );
    return Math.max(secondsUntilReset, minimumRateLimitRetryAfterSeconds);
  }

  return minimumRateLimitRetryAfterSeconds;
}

async function runGithubCallWithRateLimitRecovery(label, operation) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isGithubRateLimitError(error) || attempt >= rateLimitRecoveryRetries) {
        throw error;
      }

      const waitSeconds =
        getRateLimitRetryAfterSeconds(error) + rateLimitResetBufferSeconds;
      logNotice(
        `[rate-limit] ${label} failed after throttled retries; waiting ${waitSeconds} seconds before retry ${attempt + 1}/${rateLimitRecoveryRetries}`
      );
      await sleep(waitSeconds * 1000);
    }
  }
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return fallback;
}

async function mapWithConcurrency(items, concurrency, mapper) {
  if (!items.length) {
    return;
  }

  const limit = Math.max(1, Math.min(concurrency, items.length));
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= items.length) {
        return;
      }
      await mapper(items[currentIndex], currentIndex);
    }
  }

  const workers = Array.from({ length: limit }, () => worker());
  await Promise.all(workers);
}
