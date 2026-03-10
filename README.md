# JStats

JStats ingests GitHub organization data and stores it in Elasticsearch for Kibana dashboards that track pull requests, reviews, and review comments.

## What this repo currently contains
- Ingestion service: `app.js`
- Local Elastic/Kibana Docker setup: `elastic-docker-tls.yml`, `create-certs.yml`, `jstats.yml`
- Bootstrap helper: `bootstrap.sh`
- Versioned Kibana saved objects: `dashboards/teamwork.ndjson`

## Local startup
Run:

```bash
./bootstrap.sh
```

Then open [https://localhost:5601](https://localhost:5601).

## Dashboard as code workflow
Kibana assets are tracked in source control as NDJSON and can be imported/exported with script automation.

### Export saved objects from Kibana
```bash
KIBANA_PASSWORD='<elastic-password>' \
./scripts/kibana-saved-objects.sh export dashboards/teamwork.ndjson
```

### Import saved objects into Kibana
```bash
KIBANA_PASSWORD='<elastic-password>' \
./scripts/kibana-saved-objects.sh import dashboards/teamwork.ndjson
```

### Optional environment variables
- `KIBANA_URL` (default `https://localhost:5601`)
- `KIBANA_USERNAME` (default `elastic`)
- `KIBANA_SPACE` (default `default`)
- `KIBANA_INSECURE_TLS` (default `true`)

## Notes
- Saved objects include the `Teamwork` dashboard and related Lens visualizations/index patterns.
- Ingestion currently runs as a full scan and does not persist incremental sync checkpoints.
