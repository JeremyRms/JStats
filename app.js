import http from "http";
import pkg from "octokit";
import elastic from "@elastic/elasticsearch";
import pkgthrottling from "@octokit/plugin-throttling";
import dotenv from "dotenv";
import * as fs from "fs";
const { Octokit, App, Action } = pkg;
const { throttling } = pkgthrottling;

dotenv.config();

const server = http.createServer((request, response) => {
  response.statusCode = 200;
  response.setHeader("Content-Type", "text/plain");
  response.end();
});

const JStatsOctokit = Octokit.plugin(throttling);

const octokit = new JStatsOctokit({
  auth: `${process.env.API_KEY}`,
  userAgent: "JStats v0.1",
  timeZone: `${process.env.TIMEZONE}`,
  log: {
    debug: () => {},
    info: () => {},
    warn: console.warn,
    error: console.error,
  },
  throttle: {
    onRateLimit: (retryAfter, options) => {
      octokit.log.warn(
        `Request quota exhausted for request ${options.method} ${options.url}`
      );

      // Retry twice after hitting a rate limit error, then give up
      if (options.request.retryCount <= 2) {
        console.log(`Retrying after ${retryAfter} seconds!`);
        return true;
      }
    },
    onAbuseLimit: (retryAfter, options) => {
      // does not retry, only logs a warning
      octokit.log.warn(
        `Abuse detected for request ${options.method} ${options.url}`
      );
    },
  },
});

await octokit.rest.users.getAuthenticated().then(({ data }) => {
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
    ca: fs.readFileSync("/certs/es01/es01.key"),
    rejectUnauthorized: false,
  },
});

// cleaning up before to start
// ElasticClient.indices.delete({
//     index: '*'
// })

let repoCount;
let pullCount = 0;
let reviewCount = 0;
let commentCount = 0;

const repos = await octokit.paginate(
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
);

repoCount = repos.length;
console.info(repoCount, `repos found`);

for (const repository of repos) {
  cleanRepo(repository);

  await ElasticClient.index({
    id: repository.id,
    index: "jstats-repository",
    body: repository,
  });

  console.info(`pulling data for repository:`, repository.name);

  const pullRequests = await octokit.paginate(
    octokit.rest.pulls.list,
    {
      owner: `${process.env.ORGANIZATION}`,
      repo: repository.name,
      state: "all",
      per_page: 100,
    },
    (response) => response.data
  );

  if (pullRequests.length) {
    pullCount += pullRequests.length;
    console.info(pullCount, `pulls tally`);
  }

  for (const pullRequest of pullRequests) {
    cleanPR(pullRequest);

    await ElasticClient.index({
      id: pullRequest.id,
      index: "jstats-pullrequest",
      body: pullRequest,
    });

    // Reviews
    const reviews = await octokit.paginate(
      octokit.rest.pulls.listReviews,
      {
        owner: `${process.env.ORGANIZATION}`,
        repo: repository.name,
        pull_number: pullRequest.number,
        per_page: 100,
      },
      (response) => response.data
    );

    if (reviews.length) {
      reviewCount += reviews.length;
      console.info(reviewCount, `reviews tally`);
    }

    for (const review of reviews) {
      cleanReview(review);

      await ElasticClient.index({
        id: review.id,
        index: "jstats-review",
        body: review,
      });
    }

    // Comments
    const comments = await octokit.paginate(
      octokit.rest.pulls.listReviewComments,
      {
        owner: `${process.env.ORGANIZATION}`,
        repo: repository.name,
        pull_number: pullRequest.number,
        per_page: 100,
      },
      (response) => response.data
    );

    if (comments.length) {
      commentCount += comments.length;
      console.info(commentCount, `comments tally`);
    }

    for (const comment of comments) {
      cleanComment(comment);

      await ElasticClient.index({
        id: comment.id,
        index: "jstats-comment",
        body: comment,
      });
    }
  }
}

console.info(pullCount, `pulls found`);
console.info(reviewCount, `reviews found`);

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
}