"""Model downloads for the studio: fetch a model file from Hugging Face straight into one of ComfyUI's model folders.

POST /valis/models/fetch   {repo, path, folder, name?, size?, sha256?, revision?}  -> starts (or resumes) a download
GET  /valis/models/fetch                                                          -> every download's state
POST /valis/models/fetch/cancel {name}

The file is written as <name>.valis-part next to its destination (resumable with HTTP Range), checked against the
expected size and sha256, and only then renamed to its real name, so ComfyUI never lists a half-written model.
Only huggingface.co and ComfyUI's own model folders are allowed.
"""
import hashlib
import os
import re
import threading
import time
import urllib.parse
import urllib.request

from aiohttp import web

CHUNK = 8 << 20
EXTS = (".safetensors", ".gguf", ".sft", ".pt", ".pth", ".bin", ".ckpt", ".onnx")
JOBS = {}
LOCK = threading.Lock()


def _folder_dir(folder_paths, folder):
    if folder not in folder_paths.folder_names_and_paths:
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
                    t0, n0 = time.time(), have
                    with open(part, mode) as f:
                        while not job["cancel"]:
                            b = r.read(CHUNK)
                            if not b:
                                break
                            f.write(b)
                            have += len(b)
                            job["done"] = have
                            dt = time.time() - t0
                            if dt > 2:
                                job["rate"] = (have - n0) / dt
                if job["size"] and have >= job["size"]:
                    break
                if not job["size"]:                       # no length known and the stream ended: take it as done
                    job["size"] = have
                    break
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
        job["state"], job["error"] = "error", str(e)
        print(f"[valis] download failed for {job['name']}: {e}")


def register(routes):
    import folder_paths

    @routes.get("/valis/models/fetch")
    async def fetch_status(request):
        with LOCK:
            return web.json_response({k: {x: v for x, v in j.items() if x != "cancel"} for k, j in JOBS.items()})

    @routes.post("/valis/models/fetch")
    async def fetch_start(request):
        q = await request.json()
        repo, path = q.get("repo", ""), q.get("path", "")
        if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo):
            raise web.HTTPBadRequest(text="bad repo")
        if not path or ".." in path.split("/") or path.startswith("/"):
            raise web.HTTPBadRequest(text="bad path")
        name = q.get("name") or path.rsplit("/", 1)[-1]
        if not re.fullmatch(r"[A-Za-z0-9_.+-]{1,200}", name) or not name.lower().endswith(EXTS):
            raise web.HTTPBadRequest(text="bad file name")
        dest = os.path.join(_folder_dir(folder_paths, q.get("folder", "")), name)
        with LOCK:
            j = JOBS.get(name)
            if j and j["state"] in ("downloading", "verifying"):
                return web.json_response({"started": False, "state": j["state"]})
            if os.path.exists(dest):
                return web.json_response({"started": False, "state": "exists", "dest": dest})
            job = {"name": name, "repo": repo, "path": path, "revision": q.get("revision") or "main", "dest": dest,
                   "size": int(q.get("size") or 0), "sha256": (q.get("sha256") or "").strip(), "done": 0, "rate": 0,
                   "verified": 0, "state": "downloading", "started": time.time(), "cancel": False}
            JOBS[name] = job
        threading.Thread(target=_run, args=(job,), daemon=True, name=f"valis-fetch-{name}").start()
        return web.json_response({"started": True, "dest": dest})

    @routes.post("/valis/models/fetch/cancel")
    async def fetch_cancel(request):
        q = await request.json()
        j = JOBS.get(q.get("name", ""))
        if j:
            j["cancel"] = True
        return web.json_response({"ok": bool(j)})
