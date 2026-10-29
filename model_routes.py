"""Model downloads for the studio: fetch a model file from Hugging Face straight into one of ComfyUI's model folders.

POST /valis/models/fetch   {repo, path, folder, name?, size?, sha256?, revision?}  -> starts (or resumes) a download
GET  /valis/models/fetch                                                          -> every download's state
POST /valis/models/fetch/cancel {key} or {folder, name} (a bare {name} stops every download of that name)

The file is written as <name>.valis-part next to its destination (resumable with HTTP Range), checked against the
expected size and sha256, and only then renamed to its real name, so ComfyUI never lists a half-written model.
Only huggingface.co and ComfyUI's own model folders (not custom_nodes or configs, which hold code and settings) are
allowed. A download may not be larger than the size it was asked with (else MAX_BYTES, 100 GB; VALIS_FETCH_MAX_GB changes
it) and has to fit on the disk. The routes answer only this machine's own pages: a request from another address, or from a
page of another origin, is refused unless VALIS_ALLOW_REMOTE_FETCH=1 (ComfyUI run with --listen and the studio opened
from another machine). Downloads are keyed by "<folder>/<name>", so one file name in two folders is two downloads.
"""
import hashlib
import ipaddress
import os
import re
import shutil
import threading
import time
import urllib.parse
import urllib.request

from aiohttp import web

CHUNK = 8 << 20
EXTS = (".safetensors", ".gguf", ".sft", ".pt", ".pth", ".bin", ".ckpt", ".onnx")
BLOCKED_FOLDERS = ("custom_nodes", "configs")           # folders ComfyUI keeps in folder_paths that hold code and settings, not weights
MAX_BYTES = int(float(os.environ.get("VALIS_FETCH_MAX_GB") or 100) * (1 << 30))
SPARE = 1 << 30                                          # free disk left over after a download
REPO_PART = r"[A-Za-z0-9_][A-Za-z0-9_.-]*"              # owner or repo name: Hugging Face's never start with "." or "-" and never hold "..", so no part is ./..
ACTIVE = ("downloading", "verifying")
JOBS = {}
LOCK = threading.Lock()


class Refused(Exception):
    """A download that must stop now (not a network hiccup to retry)."""


def guard(request):
    """Only this machine's own pages may start, watch or stop a download (unless VALIS_ALLOW_REMOTE_FETCH=1)."""
    if os.environ.get("VALIS_ALLOW_REMOTE_FETCH") == "1":
        return
    peer = request.remote                                 # None: a unix socket, so a local one
    if peer is not None:
        try:
            ip = ipaddress.ip_address(peer.split("%")[0])
            local = (getattr(ip, "ipv4_mapped", None) or ip).is_loopback          # (::ffff:127.0.0.1 is this machine too)
        except ValueError:
            local = False
        if not local:
            raise web.HTTPForbidden(text="model downloads are only taken from this machine (VALIS_ALLOW_REMOTE_FETCH=1 allows others)")
    origin = request.headers.get("Origin")                # a page of another site can POST here from the browser
    if origin is not None and urllib.parse.urlsplit(origin).netloc.lower() != (request.host or "").lower():
        raise web.HTTPForbidden(text="model downloads are only taken from the studio's own page (VALIS_ALLOW_REMOTE_FETCH=1 allows others)")


async def body(request):
    try:
        q = await request.json()
    except ValueError:
        q = None
    if not isinstance(q, dict):
        raise web.HTTPBadRequest(text="the body is a JSON object")
    return q


def _folder_dir(folder_paths, folder):
    if not isinstance(folder, str) or folder in BLOCKED_FOLDERS or folder not in folder_paths.folder_names_and_paths:
        raise web.HTTPBadRequest(text=f"unknown model folder: {folder}")
    paths = folder_paths.get_folder_paths(folder)
    for p in paths:                                  # diffusion_models lists models/unet first; prefer the named one
        if os.path.basename(os.path.normpath(p)) == folder:
            return p
    return paths[0]


def _run(job):
    part = job["dest"] + ".valis-part"
    url = "https://huggingface.co/{}/resolve/{}/{}".format(
        job["repo"], urllib.parse.quote(job["revision"], safe=""), urllib.parse.quote(job["path"]))
    tries = 0
    try:
        os.makedirs(os.path.dirname(job["dest"]), exist_ok=True)
        while not job["cancel"]:
            have = os.path.getsize(part) if os.path.exists(part) else 0
            job["done"] = have
            if job["size"] and have >= job["size"]:
                break
            req = urllib.request.Request(url, headers={"User-Agent": "ComfyUI-Valis", "Range": f"bytes={have}-"})
            try:
                with urllib.request.urlopen(req, timeout=60) as r:
                    total = r.headers.get("Content-Range", "").rpartition("/")[2]
                    if total.isdigit():
                        job["size"] = job["size"] or int(total)
                    mode = "ab"
                    if have and r.status != 206:         # the server ignored Range: start over
                        mode, have = "wb", 0
                    elif not have and r.headers.get("Content-Length", "").isdigit() and r.status == 200:
                        job["size"] = job["size"] or int(r.headers["Content-Length"])
                    if job["size"] > MAX_BYTES:
                        raise Refused(f"the file is {job['size']} bytes, more than the {MAX_BYTES} a download may be")
                    t0, n0 = time.time(), have
                    with open(part, mode) as f:
                        while not job["cancel"]:
                            b = r.read(CHUNK)
                            if not b:
                                break
                            f.write(b)
                            have += len(b)
                            job["done"] = have
                            if have > min(job["size"] or MAX_BYTES, MAX_BYTES):      # more than it was asked for: stop, don't fill the disk
                                raise Refused(f"the file is larger than the {min(job['size'] or MAX_BYTES, MAX_BYTES)} bytes it may be")
                            dt = time.time() - t0
                            if dt > 2:
                                job["rate"] = (have - n0) / dt
                if job["size"] and have >= job["size"]:
                    break
                if not job["size"]:                       # no length known and the stream ended: take it as done
                    job["size"] = have
                    break
            except Refused:
                raise
            except Exception as e:                        # network hiccup: resume from what is on disk
                tries += 1
                job["note"] = f"retry {tries}: {e}"
                if tries > 30:
                    raise
                time.sleep(min(60, 2 * tries))
        if job["cancel"]:
            job["state"] = "cancelled"
            return
        have = os.path.getsize(part)
        if job["size"] and have != job["size"]:
            raise RuntimeError(f"size {have} != expected {job['size']}")
        if job["sha256"]:
            job["state"], h, n = "verifying", hashlib.sha256(), 0
            with open(part, "rb") as f:
                while b := f.read(CHUNK):
                    h.update(b)
                    n += len(b)
                    job["verified"] = n
            if h.hexdigest() != job["sha256"].lower():
                os.replace(part, job["dest"] + ".valis-bad")
                raise RuntimeError(f"sha256 mismatch: got {h.hexdigest()} (kept as .valis-bad)")
        if os.path.exists(job["dest"]):
            raise RuntimeError("destination appeared while downloading; left the .valis-part in place")
        os.replace(part, job["dest"])
        job["state"], job["finished"] = "done", time.time()
        print(f"[valis] downloaded {job['dest']}")
    except Exception as e:
        if isinstance(e, Refused):                        # what came is not a model of the size given: nothing worth resuming
            try:
                os.remove(part)
            except OSError:
                pass
        job["state"], job["error"] = "error", str(e)
        print(f"[valis] download failed for {job['name']}: {e}")


def register(routes):
    import folder_paths

    @routes.get("/valis/models/fetch")
    async def fetch_status(request):
        guard(request)
        with LOCK:
            return web.json_response({k: {x: v for x, v in j.items() if x != "cancel"} for k, j in JOBS.items()})

    @routes.post("/valis/models/fetch")
    async def fetch_start(request):
        guard(request)
        q = await body(request)
        repo, path = q.get("repo", ""), q.get("path", "")
        if not isinstance(repo, str) or not re.fullmatch(f"{REPO_PART}/{REPO_PART}", repo) or ".." in repo:
            raise web.HTTPBadRequest(text="bad repo")
        if not isinstance(path, str) or any(step in ("", ".", "..") for step in path.split("/")):
            raise web.HTTPBadRequest(text="bad path")
        name = q.get("name") or path.rsplit("/", 1)[-1]
        if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9_.+-]{1,200}", name) or not name.lower().endswith(EXTS):
            raise web.HTTPBadRequest(text="bad file name")
        folder = q.get("folder", "")
        directory = _folder_dir(folder_paths, folder)
        dest = os.path.join(directory, name)
        try:
            size = int(q.get("size") or 0)
        except (TypeError, ValueError):
            raise web.HTTPBadRequest(text="bad size")
        if size < 0 or size > MAX_BYTES:
            raise web.HTTPBadRequest(text=f"bad size: a download may be up to {MAX_BYTES} bytes")
        sha = str(q.get("sha256") or "").strip()
        key = f"{folder}/{name}"
        with LOCK:
            j = JOBS.get(key) or next((x for x in JOBS.values() if x["dest"] == dest and x["state"] in ACTIVE), None)
            if j and j["state"] in ACTIVE:
                return web.json_response({"started": False, "state": j["state"], "key": j["key"]})
            if os.path.exists(dest):
                return web.json_response({"started": False, "state": "exists", "dest": dest})
            if size:                                    # room for what is left of it, and some to spare
                part = dest + ".valis-part"
                near = directory
                while not os.path.isdir(near) and os.path.dirname(near) != near:
                    near = os.path.dirname(near)
                need = size - (os.path.getsize(part) if os.path.exists(part) else 0)
                free = shutil.disk_usage(near).free
                if free < need + SPARE:
                    raise web.HTTPInsufficientStorage(text=f"not enough free disk space: {need} bytes to come, {free} free")
            job = {"key": key, "name": name, "folder": folder, "repo": repo, "path": path, "revision": q.get("revision") or "main", "dest": dest,
                   "size": size, "sha256": sha, "done": 0, "rate": 0,
                   "verified": 0, "state": "downloading", "started": time.time(), "cancel": False}
            JOBS[key] = job
        threading.Thread(target=_run, args=(job,), daemon=True, name=f"valis-fetch-{key}").start()
        return web.json_response({"started": True, "dest": dest, "key": key})

    @routes.post("/valis/models/fetch/cancel")
    async def fetch_cancel(request):
        guard(request)
        q = await body(request)
        with LOCK:
            if q.get("key") or q.get("folder"):
                hit = [j for j in [JOBS.get(q.get("key") or f"{q.get('folder')}/{q.get('name', '')}")] if j]
            else:                                      # a bare name: every download of it
                hit = [j for j in JOBS.values() if j["name"] == q.get("name", "")]
        for j in hit:
            j["cancel"] = True
        return web.json_response({"ok": bool(hit)})
