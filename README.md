# JStats

Intended to create dashboards for GitHub data, especially number of Pull Requests, comments and reviews per contributor.

You'll need to provision your elastic search server yourself, as well as kibana. Docker compose and kibana dashboards to come soon.

## Config

`.env` file example:

```
NODE_ENV=development
API_KEY = xxxxxxxxx
HOSTNAME = '127.0.0.1'
PORT = 3000
ELASTIC_ENDPOINT = 'http://127.168.0.101'
ELASTIC_PORT = 9200
TIMEZONE = 'Asia/Bangkok'
```

## Docker containers

Tested on:

`docker pull docker.elastic.co/kibana/kibana:7.13.2`

`docker pull docker.elastic.co/elasticsearch/elasticsearch:7.13.2`

## How to launch

Simply run `node app.js` with node v16 or higher
