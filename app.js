import http from 'http';
import pkg from 'octokit';
import elastic from '@elastic/elasticsearch';

const { Octokit, App, Action } = pkg;

const hostname = '127.0.0.1';
const port = 3000;

const server = http.createServer((request, response) => {
    response.statusCode = 200;
    response.setHeader('Content-Type', 'text/plain');
    response.end()
})

const octokit = new Octokit({
    auth: `xxxx`,
    userAgent: 'JStats v0.1',
    timeZone: 'Asia/Bangkok',
    log: {
        debug: () => {},
        info: () => {},
        warn: console.warn,
        error: console.error
    },
});
// paginate
await octokit.rest.users.getAuthenticated()
    .then(({ data }) => {
    console.info(`Hello`, data.login)
});

const { Client } = elastic;
const ElasticClient = new Client({ node: 'http://192.168.99.101:9200' })

const repos = await octokit.paginate(
        octokit.rest.repos.listForOrg,
        {org:'centraldigital',type:'private', per_page:200}
    ).then(({ data }) => {
        return data
});

for (const repository of repos) {
    await ElasticClient.index({
        index: 'jstats-repository',
        body: repository
    })

    const pullRequests = await octokit.paginate(
            octokit.rest.pulls.list,
            {owner:'centraldigital', repo:repository.name}
        ).then(({ data }) => {
            return data
        });

    for (const pullrequest of pullRequests) {
        await ElasticClient.index({
            index: 'jstats-pullrequest',
            body: pullrequest
        })
    }
}



const pullRequestReviews = await octokit.rest.pulls.listReviews({
    owner:'centraldigital',
    repo:'central-category-api',
    pull_number:'1',
})
    .then(({ data }) => {
        // console.log(data)
});




// ElasticClient.indices.putMapping({
//     index: '',
//     type: "document",
//     body: {
//         properties: {
//             title: { type: "string" },
//             content: { type: "string" },
//             suggest: {
//                 type: "completion",
//                 analyzer: "simple",
//                 search_analyzer: "simple",
//                 payloads: true
//             }
//         }
//     }
// })

server.listen(port, hostname, () => {
    console.log(`Server running at http://${hostname}:${port}/`);
});