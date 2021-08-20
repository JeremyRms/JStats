import http from "http";
import pkg from "octokit";
import elastic from "@elastic/elasticsearch";
import dotenv from "dotenv";
const { Octokit, App, Action } = pkg;

dotenv.config();

const server = http.createServer((request, response) => {
  response.statusCode = 200;
  response.setHeader("Content-Type", "text/plain");
  response.end();
});

const octokit = new Octokit({
  auth: `${process.env.API_KEY}`,
  userAgent: "JStats v0.1",
  timeZone: `${process.env.TIMEZONE}`,
  log: {
    debug: () => {},
    info: () => {},
    warn: console.warn,
    error: console.error,
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
    per_page: 100,
    state: "all",
  },
  (response) => response.data
);

repoCount = repos.length;
console.info(repoCount, `repos found`);

for (const repository of repos) {
    await ElasticClient.index({
        id: repository.id,
    index: "jstats-repository",
    body: repository,
  });

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
