import { Client } from "@elastic/elasticsearch";
import * as fs from "fs";

export function createElasticClient(env = process.env) {
  const caPath = env.ELASTIC_CA_CERT_PATH || "/certs/ca/ca.crt";
  const tls = {
    rejectUnauthorized: false,
  };

  if (fs.existsSync(caPath)) {
    tls.ca = fs.readFileSync(caPath);
  }

  return new Client({
    node: `${env.ELASTIC_ENDPOINT}:${env.ELASTIC_PORT}`,
    auth: {
      username: "elastic",
      password: `${env.ELASTIC_PASSWORD}`,
    },
    tls,
  });
}

export async function bulkIndexDocuments(client, index, documents = []) {
  if (!documents.length) {
    return 0;
  }

  const operations = [];
  for (const document of documents) {
    operations.push({ index: { _index: index, _id: document.id } });
    operations.push(document);
  }

  const response = await client.bulk({
    refresh: false,
    operations,
  });
  const result = response.body || response;
  if (result.errors) {
    const firstError = result.items?.find((item) => item.index?.error)?.index?.error;
    throw new Error(
      `Elasticsearch bulk index failed for ${index}: ${
        firstError?.reason || "unknown bulk error"
      }`
    );
  }

  return documents.length;
}
