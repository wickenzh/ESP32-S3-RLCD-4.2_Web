import { createServer } from "node:https";
import { createReadStream, existsSync, mkdirSync, readFileSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(new URL(".", import.meta.url).pathname);
const certDir = join(root, ".dev_certs");
const certFile = join(certDir, "localhost.pem");
const keyFile = join(certDir, "localhost-key.pem");
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 4173);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".bin": "application/octet-stream"
};

function ensureCert() {
  mkdirSync(certDir, { recursive: true });
  if (existsSync(certFile) && existsSync(keyFile)) return;
  const result = spawnSync("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-sha256",
    "-days",
    "3650",
    "-nodes",
    "-keyout",
    keyFile,
    "-out",
    certFile,
    "-subj",
    "/CN=localhost",
    "-addext",
    "subjectAltName=DNS:localhost,IP:127.0.0.1"
  ], { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error("Failed to generate HTTPS certificate with openssl.");
  }
}

function resolveRequestPath(url) {
  const pathname = decodeURIComponent(new URL(url, `https://${host}:${port}`).pathname);
  const relative = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = normalize(join(root, relative));
  if (!filePath.startsWith(root)) return null;
  return filePath;
}

ensureCert();

const server = createServer({
  cert: readFileSync(certFile),
  key: readFileSync(keyFile)
}, (req, res) => {
  if (!["GET", "HEAD"].includes(req.method || "")) {
    res.writeHead(405);
    res.end();
    return;
  }
  const filePath = resolveRequestPath(req.url || "/");
  if (!filePath || !existsSync(filePath)) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }
  res.writeHead(200, {
    "content-type": mimeTypes[extname(filePath)] || "application/octet-stream",
    "cache-control": "no-store"
  });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  createReadStream(filePath).pipe(res);
});

server.listen(port, host, () => {
  console.log(`Serving HTTPS on https://${host}:${port}/`);
  console.log(`Certificate: ${certFile}`);
});
