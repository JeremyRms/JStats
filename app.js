import http from "http";
import pkg from "octokit";
import elastic from "@elastic/elasticsearch";
import pkgthrottling from "@octokit/plugin-throttling";
import dotenv from "dotenv";
import * as fs from "fs";
import { Worker, isMainThread, parentPort, workerData } from "worker_threads";

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
  var worker = new Worker("./repository.js");
  worker.addListener('message', function(e) {
    console.log(e.data);
  }, false);
  worker.postMessage(repository);
}

console.info(pullCount, `pulls found`);
console.info(reviewCount, `reviews found`);

let port = process.env.PORT;
let hostname = process.env.HOSTNAME;

server.listen(port, hostname, () => {
  console.log(`Server running at http://${hostname}:${port}/`);
});
