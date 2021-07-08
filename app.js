import http from 'http';
import pkg from 'octokit';
import elastic from '@elastic/elasticsearch';
import dotenv from 'dotenv';
const { Octokit, App, Action } = pkg;

dotenv.config();

const server = http.createServer((request, response) => {
    response.statusCode = 200;
    response.setHeader('Content-Type', 'text/plain');
    response.end()
})

const octokit = new Octokit({
    auth: `${process.env.API_KEY}`,
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

const { Client } = elastic;
const ElasticClient = new Client({ node: 'http://192.168.99.101:9200' })

const repos = await octokit.paginate(
        octokit.rest.repos.listForOrg,
        {org:'centraldigital',type:'private',per_page: 100},
        response => response.data
    )

// throw repos[0]

for (const repository of repos) {
    await ElasticClient.index({
        id: repository.id,
        index: 'jstats-repository',
        body: repository
    })

    const pullRequests = await octokit.paginate(
        octokit.rest.pulls.list,
        {owner:'centraldigital', repo:repository.name,per_page: 100},
        response => response.data
    )

    for (const pullrequest of pullRequests) {
        await ElasticClient.index({
            id: pullrequest.id,
            index: 'jstats-pullrequest',
            body: pullrequest
        })
    }
}

// const pullRequestReviews = await octokit.rest.pulls.listReviews({
//     owner:'centraldigital',
//     repo:'central-category-api',
//     pull_number:'1',
// })
//     .then(({ data }) => {
//         // console.log(data)
// });




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
    console.log(`Server running at http://${process.env.HOSTNAME}:${process.env.PORT}/`);
});