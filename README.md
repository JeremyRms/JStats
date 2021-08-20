# JStats

Intended to create dashboards for GitHub data, especially number of Pull Requests, comments and reviews per contributor.

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

# docker specific settings
COMPOSE_PROJECT_NAME=JStats
CERTS_DIR=/usr/share/elasticsearch/config/certificates
VERSION=7.14.0
```

## How to launch

Create servers, volumes and network with the following command:

`docker-compose -f elastic-docker-tls.yml up -d`

Simply run `node app.js` with node v16 or higher to populate your ElasticSearch index with GitHub data.
