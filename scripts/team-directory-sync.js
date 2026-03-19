#!/usr/bin/env node

import dotenv from "dotenv";
import {
  bulkIndexDocuments,
  createElasticClient,
} from "../src/elastic-client.js";
import {
  buildMemberDocuments,
  buildTeamDocuments,
  loadTeamDirectory,
  resolveTeamDirectoryFile,
} from "../src/team-directory.js";

dotenv.config();

try {
  const filePath = resolveTeamDirectoryFile();
  const directory = loadTeamDirectory(filePath);
  const elasticClient = createElasticClient();
  const teamDocuments = buildTeamDocuments(directory);
  const memberDocuments = buildMemberDocuments(directory);

  await replaceIndexDocuments(elasticClient, "jstats-directory-team", teamDocuments);
  await replaceIndexDocuments(
    elasticClient,
    "jstats-directory-member",
    memberDocuments
  );

  console.info(`Loaded team directory from ${filePath}`);
  console.info(
    `Indexed ${teamDocuments.length} teams into jstats-directory-team`
  );
  console.info(
    `Indexed ${memberDocuments.length} members into jstats-directory-member`
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

async function replaceIndexDocuments(client, index, documents) {
  await client.deleteByQuery(
    {
      index,
      conflicts: "proceed",
      refresh: true,
      body: {
        query: {
          match_all: {},
        },
      },
    },
    {
      ignore: [404],
    }
  );

  if (!documents.length) {
    return 0;
  }

  return bulkIndexDocuments(client, index, documents);
}
