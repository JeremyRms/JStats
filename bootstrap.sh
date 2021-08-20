#!/bin/bash

# creates certificates
docker-compose -f create-certs.yml run --rm create_certs 

# creates and starts containers
docker-compose -f elastic-docker-tls.yml up -d         

# mkdir ~/.elk

# generates root password
docker exec es01 /bin/bash -c "bin/elasticsearch-setup-passwords auto --batch --url https://es01:9200"  > ~/.elk/elastic-stack 

# finds and replace the kibana user password in the TLS file
kibanaPassword=`sed -rn 's/PASSWORD kibana_system = ([a-zA-Z0-9]*)[:space:]/\1/p' ~/.elk/elastic-stack`
echo $kibanaPassword
sed -i "" "s/CHANGEME/$kibanaPassword/g" elastic-docker-tls.yml

# restarting...
docker-compose stop
docker-compose -f elastic-docker-tls.yml up -d