import http from 'http';
import pkg from 'octokit';
import pkg from 'octokit';

const { Octokit, App, Action } = pkg;

const hostname = '127.0.0.1';
const port = 3000;

const server = http.createServer((request, response) => {
    response.statusCode = 200;
    response.setHeader('Content-Type', 'text/plain');
    response.end()
})

const octokit = new Octokit({
    auth: `xxxxxxxxxxxx`,
    userAgent: 'JStats v0.1',
    timeZone: 'Asia/Bangkok',
    log: {
        debug: () => {},
        info: () => {},
        warn: console.warn,
        error: console.error
    },
});

await octokit.rest.users.getAuthenticated()
    .then(({ data }) => {
    console.info(`Hello`, data.login)
});

const repos = await octokit.rest.repos.listForOrg({org:'centraldigital',type:'private'})
    .then(({ data }) => {
        return data
});

repos.forEach((item) => {
    // console.log(item.name)
})

const pullRequests = await octokit.rest.pulls.list({owner:'centraldigital', repo:'centech-api'})
    .then(({ data }) => {
        // console.log(data)
});

const pullRequestReviews = await octokit.rest.pulls.listReviews({
    owner:'centraldigital',
    repo:'central-category-api',
    pull_number:'1',
})
    .then(({ data }) => {
        // console.log(data)
});

const { Client } = pkg;
const ElasticClient = new Client({ node: 'http://localhost:9200' })

ElasticClient.indices.putMapping({
    index: '',
    type: "document",
    body: {
        properties: {
            title: { type: "string" },
            content: { type: "string" },
            suggest: {
                type: "completion",
                analyzer: "simple",
                search_analyzer: "simple",
                payloads: true
            }
        }
    }
})

server.listen(port, hostname, () => {
    console.log(`Server running at http://${hostname}:${port}/`);
});