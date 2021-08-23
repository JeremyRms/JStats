# JStats

Intended to create dashboards for GitHub data, especially number of Pull Requests, comments and reviews per contributor.

## Config

`.env` file example:

```
# docker specific settings
COMPOSE_PROJECT_NAME=JStats
CERTS_DIR=/usr/share/elasticsearch/config/certificates
VERSION=7.14.0

# app configuration settings
NODE_ENV = development
API_KEY = 'CHANGEME'
HOSTNAME = 'localhost'
PORT = 3000
ELASTIC_ENDPOINT = 'https://localhost'
ELASTIC_PORT = 9200
TIMEZONE = 'Asia/Bangkok'
ORGANIZATION = 'CHANGEME'
ELASTIC_PASSWORD = 'CHANGEME'
```

## How to launch

Create servers, volumes and network with the following command:
`docker-compose -f elastic-docker-tls.yml up -d`

## TODO:

[x] Add a container for the NodeJs application.
[ ] import kibana dashboard
