const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const temporaryStorage = fs.mkdtempSync(path.join(os.tmpdir(), "cipher-share-test-"));
process.env.STORAGE_DIR = temporaryStorage;
const { createServer, isShareId } = require("../server");

test.after(() => fs.rmSync(temporaryStorage, { recursive: true, force: true }));

test("share IDs accept only expected opaque identifiers", () => {
  assert.equal(isShareId("a".repeat(32)), true);
  assert.equal(isShareId("../secret"), false);
  assert.equal(isShareId("A".repeat(32)), false);
});

test("stores and retrieves bytes without changing them", async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const ciphertext = crypto.getRandomValues(new Uint8Array(128));
    const upload = await fetch(`${baseUrl}/api/files`, { method: "POST", body: ciphertext });
    assert.equal(upload.status, 201);
    const { id } = await upload.json();
    assert.equal(isShareId(id), true);

    const download = await fetch(`${baseUrl}/api/files/${id}`);
    assert.equal(download.status, 200);
    assert.deepEqual(new Uint8Array(await download.arrayBuffer()), ciphertext);
    assert.equal(download.headers.get("cache-control"), "no-store");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("does not expose missing or malformed file IDs", async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${baseUrl}/api/files/not-an-id`)).status, 404);
    assert.equal((await fetch(`${baseUrl}/api/files/${"0".repeat(32)}`)).status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("rejects an upload declared above the size limit", async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const result = await new Promise((resolve, reject) => {
      const request = http.request(`${baseUrl}/api/files`, {
        method: "POST",
        headers: { "Content-Length": String(25 * 1024 * 1024 + 1) },
      }, (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => { body += chunk; });
        response.on("end", () => resolve({ status: response.statusCode, body }));
      });
      request.on("error", reject);
      request.end();
    });
    assert.equal(result.status, 413);
    assert.match(JSON.parse(result.body).error, /too large/i);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
