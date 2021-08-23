#!/bin/bash

echo Tear down previous installation...
docker-compose down -v --remove-orphans --timeout 10

if [ ! -f ".env" ]; then
    echo "Adding .env file."
    touch .env
    {
        echo '# docker specific settings'
        echo 'COMPOSE_PROJECT_NAME=JStats'
        echo 'CERTS_DIR=/usr/share/elasticsearch/config/certificates'
        echo 'VERSION=7.14.0'
        echo '# app configuration settings'
        echo 'NODE_ENV = development'
        echo 'API_KEY = GITHUBAPIKEY'
        echo 'HOSTNAME = localhost'
        echo 'PORT = 3000'
        echo 'ELASTIC_ENDPOINT = https://es01'
        echo 'ELASTIC_PORT = 9200'
        echo 'TIMEZONE = Asia/Bangkok'
        echo 'ORGANIZATION = GITHUBORGANIZATION'
        echo 'ELASTIC_PASSWORD = ELASTICUSERPASSWORD'
    } > .env

    echo -e GitHub API Key?
    read -sp 'API KEY: ' API_KEY

    sed -i "" "s/GITHUBAPIKEY/$API_KEY/g" .env

    echo -e GitHub Organization name?
    read ORGANIZATION

    sed -i "" "s/GITHUBORGANIZATION/$ORGANIZATION/g" .env
fi

echo Creating certificates...
docker-compose -f create-certs.yml run --rm create_certs

echo Creating and staring containers...
docker-compose -f elastic-docker-tls.yml up -d         

mkdir ~/.elk

echo Generating ELK passwords...
docker exec es01 /bin/bash -c "bin/elasticsearch-setup-passwords auto --batch --url https://es01:9200"  > ~/.elk/elastic-stack 

echo Finds and replace the kibana user password in the .env file...
elasticPassword=`sed -rn 's/PASSWORD elastic = ([a-zA-Z0-9]*)/\1/p' ~/.elk/elastic-stack`
sed -i "" "s/ELASTICUSERPASSWORD/$elasticPassword/g" .env

echo Restarting containers...
docker-compose stop
docker-compose -f elastic-docker-tls.yml up -d

echo Importing dashboards...

echo Running the application...
docker-compose -f jstats.yml run --rm jstats 