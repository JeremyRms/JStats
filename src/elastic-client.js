import elastic from "@elastic/elasticsearch";
import * as fs from "fs";

const { Client } = elastic;

export function createElasticClient(env = process.env) {
  const caPath = env.ELASTIC_CA_CERT_PATH || "/certs/ca/ca.crt";
  const ssl = {
    rejectUnauthorized: false,
  };

  if (fs.existsSync(caPath)) {
    ssl.ca = fs.readFileSync(caPath);
  }

  return new Client({
    node: `${env.ELASTIC_ENDPOINT}:${env.ELASTIC_PORT}`,
    auth: {
      username: "elastic",
      password: `${env.ELASTIC_PASSWORD}`,
    },
    ssl,
  });
}

