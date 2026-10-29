// A stand-in ComfyUI for the studio's UI tests: serves the studio and answers the endpoints it reads (the node list,
// system stats, queue, history, the user file store, /view) from snapshots, with no GPU and no models.
//
//   node tests/ui/mock_server.mjs [port] [--object-info path] [--media dir]
// --media: a folder laid out like ComfyUI/output (files served by /view?filename&subfolder&type=output)
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, "..", "..");
const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const PORT = Number(args.find(a => /^\d+$/.test(a)) || 8288);
const OI = JSON.parse(fs.readFileSync(opt("--object-info", path.join(repo, "tests", "fixtures", "object_info.json")), "utf8"));
const MEDIA = opt("--media", path.join(here, "media"));
// ComfyUI's per-user files (plans, the bin, timings): a fresh empty folder, or --user dir to start from saved ones
const USER = opt("--user", null) || fs.mkdtempSync(path.join(process.env.TMPDIR || "/tmp", "valis-user-"));
const STATS = {system: {os: "nt", ram_total: 31.9e9, ram_free: 9.9e9, comfyui_version: "0.42.0", python_version: "3.12.7", pytorch_version: "2.13.0+cu130",
  embedded_python: true, argv: ["ComfyUI\\main.py", "--windows-standalone-build"]},
  devices: [{name: "cuda:0 NVIDIA GeForce RTX 4080 Laptop GPU : cudaMallocAsync", type: "cuda", index: 0, vram_total: 12878086144, vram_free: 9589650372}]};
const TYPES = {".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg",
  ".webm": "video/webm", ".mp4": "video/mp4", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".woff2": "font/woff2", ".ttf": "font/ttf", ".svg": "image/svg+xml", ".gif": "image/gif"};
const UPLOADS = [], IMAGES = [];
const send = (res, code, body, type = "application/json") => { res.writeHead(code, {"Content-Type": type, "Cache-Control": "no-cache"}); res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
function file(res, p, head = false) {
  if (!fs.existsSync(p) || !fs.statSync(p).isFile()) return send(res, 404, "not found", "text/plain");
  res.writeHead(200, {"Content-Type": TYPES[path.extname(p).toLowerCase()] || "application/octet-stream", "Content-Length": fs.statSync(p).size});
  if (head) return res.end();
  fs.createReadStream(p).pipe(res);
}
const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`), p = decodeURIComponent(u.pathname);
  if (p === "/valis") return file(res, path.join(repo, "app", "index.html"));
  if (p.startsWith("/valis/app/")) { const f = path.resolve(repo, "app", p.slice("/valis/app/".length)); return f.startsWith(path.join(repo, "app")) ? file(res, f) : send(res, 403, "no"); }
  if (p === "/object_info") return send(res, 200, OI);
  if (p.startsWith("/object_info/")) { const n = p.slice(13); return send(res, 200, OI[n] ? {[n]: OI[n]} : {}); }
  if (p === "/system_stats") return send(res, 200, STATS);
  if (p === "/queue") return send(res, 200, {queue_running: [], queue_pending: []});
  if (p === "/history" || p.startsWith("/history/")) return send(res, 200, {});
  if (p === "/api/v2/health") return send(res, 200, {ok: true});
  if (p === "/view") {
    const f = path.join(MEDIA, u.searchParams.get("subfolder") || "", u.searchParams.get("filename") || "");
    return file(res, f, req.method === "HEAD");
  }
  if (p.startsWith("/api/userdata")) {
    if (p === "/api/userdata") {                       // a listing
      const dir = path.join(USER, u.searchParams.get("dir") || "");
      const list = fs.existsSync(dir) ? fs.readdirSync(dir).map(f => ({path: f, size: fs.statSync(path.join(dir, f)).size, modified: fs.statSync(path.join(dir, f)).mtimeMs / 1000})) : [];
      return send(res, 200, list);
    }
    const f = path.join(USER, decodeURIComponent(p.slice("/api/userdata/".length)));
    if (req.method === "POST") { const chunks = []; req.on("data", c => chunks.push(c)); req.on("end", () => { fs.mkdirSync(path.dirname(f), {recursive: true}); fs.writeFileSync(f, Buffer.concat(chunks)); send(res, 200, {ok: true}); }); return; }
    return file(res, f);
  }
  // Comfy API v2 assets, enough for api.upload(): the by-hash check says "unknown", a POST registers the file
  if (p.startsWith("/api/v2/assets")) {
    if (req.method === "HEAD") { res.writeHead(404); return res.end(); }
    if (req.method === "POST") {
      const chunks = []; req.on("data", c => chunks.push(c)); req.on("end", () => {
        const body = Buffer.concat(chunks).toString("latin1"), field = (n) => (new RegExp(`name="${n}"\\r\\n\\r\\n([^\\r]*)`).exec(body) || [])[1];
        const id = crypto.randomUUID(); UPLOADS.push({id, file_path: field("file_path"), hash: field("expected_hash"), bytes: body.length});
        send(res, 201, {id, hash: field("expected_hash"), size_bytes: body.length, content_type: field("content_type"), file_path: field("file_path"), created_new: true});
      }); return;
    }
    return send(res, 404, {error: {code: "not_found", message: "no"}});
  }
  // ComfyUI's /upload/image (the picture a Film plan holds as one of its input files): kept in a list, answered as ComfyUI does
  if (p === "/upload/image" && req.method === "POST") {
    const chunks = []; req.on("data", c => chunks.push(c)); req.on("end", () => {
      const body = Buffer.concat(chunks).toString("latin1"), field = (n) => (new RegExp(`name="${n}"\\r\\n\\r\\n([^\\r]*)`).exec(body) || [])[1];
      const name = (/name="image"; filename="([^"]*)"/.exec(body) || [])[1] || "image.png";
      IMAGES.push({name, subfolder: field("subfolder") || "", type: field("type") || "input", bytes: body.length});
      send(res, 200, {name, subfolder: field("subfolder") || "", type: field("type") || "input"});
    }); return;
  }
  if (p === "/__images") return send(res, 200, IMAGES);
  if (p === "/__uploads") return send(res, 200, UPLOADS);
  if (p === "/free" || p === "/interrupt") return send(res, 200, {});
  send(res, 404, "not found", "text/plain");
});
// ComfyUI's /ws, enough for the studio's connection light: the handshake, then a quiet open socket
server.on("upgrade", (req, sock) => {
  if (!req.url.startsWith("/ws")) return sock.destroy();
  const accept = crypto.createHash("sha1").update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  sock.on("error", () => {});
});
server.listen(PORT, () => console.log(`mock ComfyUI on http://localhost:${PORT}/valis (user files in ${USER})`));
