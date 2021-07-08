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

let repoCount = 0
let pullCount = 0
let reviewCount = 0
const repos = await octokit.paginate(
        octokit.rest.repos.listForOrg,
        {org:'centraldigital',type:'private',per_page: 100,state:'all'},
        response => response.data
    )

repoCount = repos.length
console.info(repoCount, `repos found`)

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

    if (pullRequests.length) {
        pullCount += pullRequests.length
        console.info(pullCount, `pulls tally`)
    }

    for (const pullrequest of pullRequests) {
        await ElasticClient.index({
            id: pullrequest.id,
            index: 'jstats-pullrequest',
            body: pullrequest
        })

        const reviews = await octokit.paginate(
            octokit.rest.pulls.listReviews,
            {owner:'centraldigital', repo:repository.name,pull_number:pullrequest.number,per_page: 100},
            response => response.data
        )
        if (reviews.length) {
            reviewCount += reviews.length
            console.info(reviewCount, `reviews tally`)
        }

        for (const review of reviews) {
            await ElasticClient.index({
                id: review.id,
                index: 'jstats-review',
                body: review
            })
        }
    }
}

console.info(pullCount, `pulls found`)
console.info(reviewCount, `reviews found`)

let port = process.env.PORT;
let hostname = process.env.HOSTNAME


server.listen(port, hostname, () => {
    console.log(`Server running at http://${hostname}:${port}/`);
});