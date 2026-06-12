import assert from "node:assert/strict";
import test from "node:test";
import { bulkIndexDocuments } from "../src/elastic-client.js";

test("bulkIndexDocuments sends Elasticsearch 8 bulk operations", async () => {
  const calls = [];
  const client = {
    async bulk(params) {
      calls.push(params);
      return { errors: false };
    },
  };
  const documents = [
    {
      id: "doc-1",
      name: "Example",
    },
  ];

  const indexed = await bulkIndexDocuments(client, "jstats-test", documents);

  assert.equal(indexed, 1);
  assert.deepEqual(calls, [
    {
      refresh: false,
      operations: [
        {
          index: {
            _index: "jstats-test",
            _id: "doc-1",
          },
        },
        documents[0],
      ],
    },
  ]);
});

test("bulkIndexDocuments reports the first Elasticsearch bulk error", async () => {
  const client = {
    async bulk() {
      return {
        errors: true,
        items: [
          {
            index: {
              error: {
                reason: "mapper parsing failed",
              },
            },
          },
        ],
      };
    },
  };

  await assert.rejects(
    () =>
      bulkIndexDocuments(client, "jstats-test", [
        {
          id: "doc-1",
        },
      ]),
    /mapper parsing failed/
  );
});
