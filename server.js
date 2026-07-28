const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 3000);
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const PUBLIC_DIR = path.join(__dirname, "public");
const STORAGE_DIR = process.env.STORAGE_DIR || path.join(__dirname, "storage");

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  response.end(body);
}

function isShareId(value) {
  return /^[a-f0-9]{32}$/.test(value);
}

async function storeUpload(request, response) {
  const declaredSize = Number(request.headers["content-length"]);
  if (Number.isFinite(declaredSize) && declaredSize > MAX_FILE_BYTES) {
    sendJson(response, 413, { error: "Encrypted file is too large (25 MB maximum)." });
    request.resume();
    return;
  }

  const id = crypto.randomBytes(16).toString("hex");
  const temporaryPath = path.join(STORAGE_DIR, `${id}.uploading`);
  const finalPath = path.join(STORAGE_DIR, `${id}.bin`);
  const output = fs.createWriteStream(temporaryPath, { flags: "wx" });
  let received = 0;
  let failed = false;

  const cleanup = () => fs.rm(temporaryPath, { force: true }, () => {});
  request.on("data", (chunk) => {
    received += chunk.length;
    if (received > MAX_FILE_BYTES && !failed) {
      failed = true;
      request.unpipe(output);
      output.destroy();
      cleanup();
      request.resume();
      sendJson(response, 413, { error: "Encrypted file is too large (25 MB maximum)." });
    }
  });
  request.pipe(output);

  output.on("error", () => {
    if (!response.headersSent) sendJson(response, 500, { error: "Could not store encrypted file." });
    cleanup();
  });
  output.on("finish", () => {
    if (failed) {
      return;
    }
    if (received === 0) {
      cleanup();
      sendJson(response, 400, { error: "Upload body is empty." });
      return;
    }
    fs.rename(temporaryPath, finalPath, (error) => {
      if (error) {
        cleanup();
        sendJson(response, 500, { error: "Could not finalize encrypted file." });
        return;
      }
      sendJson(response, 201, { id });
    });
  });
}

function sendStoredFile(id, response) {
  if (!isShareId(id)) {
    sendJson(response, 404, { error: "Encrypted file not found." });
    return;
  }
  const filePath = path.join(STORAGE_DIR, `${id}.bin`);
  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) {
      sendJson(response, 404, { error: "Encrypted file not found." });
      return;
    }
    response.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Content-Length": stats.size,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    fs.createReadStream(filePath).pipe(response);
  });
}

function sendStatic(pathname, response) {
  const requested = pathname === "/" || pathname.startsWith("/share/") ? "index.html" : pathname.slice(1);
  const filePath = path.resolve(PUBLIC_DIR, requested);
  if (!filePath.startsWith(`${PUBLIC_DIR}${path.sep}`)) {
    sendJson(response, 404, { error: "Not found." });
    return;
  }
  fs.readFile(filePath, (error, body) => {
    if (error) {
      sendJson(response, 404, { error: "Not found." });
      return;
    }
    response.writeHead(200, {
      "Content-Type": contentTypes[path.extname(filePath)] || "application/octet-stream",
      "Content-Length": body.length,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' blob:; media-src 'self' blob:; object-src 'none'; base-uri 'none'",
    });
    response.end(body);
  });
}

function createServer() {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
  return http.createServer((request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (request.method === "POST" && url.pathname === "/api/files") {
      storeUpload(request, response);
      return;
    }
    const match = url.pathname.match(/^\/api\/files\/([^/]+)$/);
    if (request.method === "GET" && match) {
      sendStoredFile(match[1], response);
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      sendJson(response, 404, { error: "Not found." });
      return;
    }
    if (request.method !== "GET") {
      sendJson(response, 405, { error: "Method not allowed." });
      return;
    }
    sendStatic(url.pathname, response);
  });
}

if (require.main === module) {
  createServer().listen(PORT, HOST, () => {
    console.log(`CipherShare is running at http://${HOST}:${PORT}`);
  });
}

module.exports = { createServer, isShareId };
