"""The model download routes (model_routes.py), run for real on an aiohttp server with a stand-in for Hugging Face and
ComfyUI's folder_paths: code folders and cross-site or remote requests are refused, a download can't be larger than the
size it was asked with or fill the disk, the same file name in two folders is two downloads, and a file that arrives is
checked and renamed into place (needs aiohttp; no ComfyUI, no network).

    python3 tests/check_model_routes.py
"""
import asyncio
import hashlib
import json
import logging
import os
import sys
import tempfile
import threading
import time
import types

try:
    from aiohttp import web
    from aiohttp.test_utils import TestClient, TestServer
except ImportError:
    print("check_model_routes: needs aiohttp (pip install aiohttp); skipped")
    sys.exit(0)

logging.getLogger("aiohttp.server").setLevel(logging.CRITICAL)
repo = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
passed = failed = 0


def ok(cond, name, detail=""):
    global passed, failed
    if cond:
        passed += 1
    else:
        failed += 1
        print(f"FAIL {name}{': ' + str(detail) if detail not in (None, '') else ''}")


MODELS = tempfile.mkdtemp()
DIRS = {k: os.path.join(MODELS, k) for k in ("loras", "diffusion_models", "custom_nodes", "configs")}
fp = types.ModuleType("folder_paths")
fp.folder_names_and_paths = {k: ([d], {".safetensors"}) for k, d in DIRS.items()}
fp.get_folder_paths = lambda folder: [DIRS[folder]]
sys.modules["folder_paths"] = fp

pkg = types.ModuleType("valispkg")                                    # the repo as a package, without running its __init__ (torch)
pkg.__path__ = [os.path.abspath(repo)]
sys.modules["valispkg"] = pkg
from valispkg import model_routes as mr  # noqa: E402

# ---- a stand-in Hugging Face: what a URL answers, with Range, and an optional gate a download waits at
FILES = {}                         # file name -> bytes
GATES = {}                         # file name -> Event the first read waits for
URLS = []


class Resp:
    def __init__(self, data, start, gate):
        self.data, self.pos, self.gate = data, start, gate
        self.status = 206 if start else 200
        total = len(data)
        self.headers = {"Content-Length": str(total - start)}
        if start:
            self.headers["Content-Range"] = f"bytes {start}-{total - 1}/{total}"

    def read(self, n):
        if self.gate:
            self.gate.wait(10)
        b = self.data[self.pos:self.pos + n]
        self.pos += len(b)
        return b

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def urlopen(req, timeout=None):
    URLS.append(req.full_url)
    assert req.full_url.startswith("https://huggingface.co/"), req.full_url
    name = req.full_url.rsplit("/", 1)[-1]
    start = int((req.get_header("Range") or "bytes=0-").split("=")[1].split("-")[0])
    return Resp(FILES[name], start, GATES.get(name))


mr.urllib.request.urlopen = urlopen
mr.time.sleep = lambda s: None                                        # (no failure here is a network one worth waiting for)


async def main():
    app = web.Application()
    routes = web.RouteTableDef()
    mr.register(routes)
    app.add_routes(routes)
    async with TestClient(TestServer(app)) as c:
        host = f"{c.server.host}:{c.server.port}"

        async def post(url, headers=None, **body):
            r = await c.post(url, json=body, headers=headers)
            text = await r.text()
            try:
                return r.status, json.loads(text)
            except ValueError:
                return r.status, text

        async def start(name, folder="loras", **kw):
            return await post("/valis/models/fetch", repo="a/b", path=name, folder=folder, name=kw.pop("as_name", None) or name, **kw)

        async def status():
            return await (await c.get("/valis/models/fetch")).json()

        async def settle(key, timeout=5):
            t0 = time.time()
            while time.time() - t0 < timeout:
                j = (await status()).get(key)
                if j and j["state"] not in mr.ACTIVE:
                    return j
                await asyncio.sleep(.02)
            return (await status()).get(key)

        def reset():
            mr.JOBS.clear()
            for d in DIRS.values():
                for f in os.listdir(d) if os.path.isdir(d) else []:
                    os.remove(os.path.join(d, f))

        # ---- a file that arrives is checked and put in place
        data = os.urandom(5000)
        FILES["a.safetensors"] = data
        sha = hashlib.sha256(data).hexdigest()
        st, r = await start("a.safetensors", size=len(data), sha256=sha)
        ok(st == 200 and r["started"] and r["key"] == "loras/a.safetensors" and r["dest"] == os.path.join(DIRS["loras"], "a.safetensors"), "a download starts", (st, r))
        j = await settle("loras/a.safetensors")
        ok(j and j["state"] == "done" and open(os.path.join(DIRS["loras"], "a.safetensors"), "rb").read() == data, "and arrives, checked", j)
        ok(not os.path.exists(os.path.join(DIRS["loras"], "a.safetensors.valis-part")), "(no part file left)")
        st, r = await start("a.safetensors", size=len(data))
        ok(st == 200 and r["started"] is False and r["state"] == "exists", "a file that is there is never fetched again", (st, r))
        reset()
        FILES["h.safetensors"] = data
        await start("h.safetensors", size=len(data), sha256="0" * 64)
        j = await settle("loras/h.safetensors")
        ok(j["state"] == "error" and "sha256 mismatch" in j["error"] and not os.path.exists(os.path.join(DIRS["loras"], "h.safetensors")), "a file that fails its hash is not put in place", j)
        reset()

        # ---- the folder: weights go in model folders, not where ComfyUI keeps code and settings
        for folder in ("custom_nodes", "configs", "nowhere", "", "../loras"):
            st, r = await start("x.safetensors", folder=folder, size=10)
            ok(st == 400, f"folder {folder!r} is refused", (st, r))
        ok(not any(os.path.isdir(DIRS[k]) for k in ("custom_nodes", "configs")) and not mr.JOBS, "(nothing was started or written in a code folder)", list(mr.JOBS))
        st, r = await post("/valis/models/fetch", repo="a/b", path="x.safetensors", folder=["loras"], size=10)
        ok(st == 400, "a folder that isn't a string is a 400, not a 500", (st, r))

        # ---- the other arguments
        for what, kw in {"a repo that isn't a repo": {"repo": "a/b/c"}, "a path out of the repo": {"path": "../x.safetensors"}, "an absolute path": {"path": "/x.safetensors"},
                         "a file type that isn't a model": {"path": "x.py"}, "a size that isn't a number": {"size": "big"}, "a negative size": {"size": -1},
                         "a size over the limit": {"size": mr.MAX_BYTES + 1}, "a name with a slash": {"name": "a/x.safetensors"}}.items():
            q = {"repo": "a/b", "path": "x.safetensors", "folder": "loras", "size": 10, **kw}
            st, r = await post("/valis/models/fetch", **q)
            ok(st == 400, f"{what} is a 400", (st, r))
        r = await c.post("/valis/models/fetch", data=b"[1, 2]", headers={"Content-Type": "application/json"})
        ok(r.status == 400, "a body that isn't an object is a 400")
        r = await c.post("/valis/models/fetch", data=b"{broken", headers={"Content-Type": "application/json"})
        ok(r.status == 400, "a body that isn't JSON is a 400")
        ok(not mr.JOBS, "(none of them started)", list(mr.JOBS))

        # ---- room on the disk
        real = mr.shutil.disk_usage
        mr.shutil.disk_usage = lambda p: types.SimpleNamespace(total=10 ** 12, used=0, free=1000)
        st, r = await start("x.safetensors", size=10)
        mr.shutil.disk_usage = real
        ok(st == 507 and not mr.JOBS, "a download that won't fit is refused up front", (st, r))

        # ---- a download can't be larger than it was asked to be
        FILES["big.safetensors"] = b"x" * 50
        await start("big.safetensors", size=5)
        j = await settle("loras/big.safetensors")
        ok(j["state"] == "error" and "larger" in j["error"], "more than the size given is an error", j)
        ok(not os.path.exists(os.path.join(DIRS["loras"], "big.safetensors.valis-part")), "and the part file is removed", os.listdir(DIRS["loras"]))
        ok(j.get("note") is None, "and is not retried", j.get("note"))
        old = mr.MAX_BYTES
        mr.MAX_BYTES = 20
        await start("big.safetensors", as_name="big2.safetensors")                      # no size given: the server's own limit holds
        j = await settle("loras/big2.safetensors")
        mr.MAX_BYTES = old
        ok(j["state"] == "error" and ("bytes" in j["error"]), "a file the server says is over the limit is refused with no size given", j)
        ok(not os.path.exists(os.path.join(DIRS["loras"], "big2.safetensors.valis-part")), "(and no part is left)", os.listdir(DIRS["loras"]))
        reset()

        # ---- the same name in two folders is two downloads, each with its own state, and one can be stopped alone
        FILES["same.safetensors"] = b"s" * 3000
        GATES["same.safetensors"] = gate = threading.Event()
        st1, r1 = await start("same.safetensors", folder="loras", size=3000)
        st2, r2 = await start("same.safetensors", folder="diffusion_models", size=3000)
        ok(r1["started"] and r2["started"] and r1["key"] != r2["key"], "the same name in two folders both start", (r1, r2))
        s = await status()
        ok(set(s) == {"loras/same.safetensors", "diffusion_models/same.safetensors"} and s["loras/same.safetensors"]["dest"] != s["diffusion_models/same.safetensors"]["dest"], "each has its own state", list(s))
        st, r = await start("same.safetensors", folder="loras", size=3000)
        ok(r["started"] is False and r["state"] == "downloading" and r["key"] == "loras/same.safetensors", "asking again for one that's running says so", r)
        st, r = await post("/valis/models/fetch/cancel", folder="diffusion_models", name="same.safetensors")
        ok(st == 200 and r["ok"], "one is cancelled by folder and name", (st, r))
        gate.set()
        a, b = await settle("loras/same.safetensors"), await settle("diffusion_models/same.safetensors")
        ok(a["state"] == "done" and os.path.exists(os.path.join(DIRS["loras"], "same.safetensors")), "the other one finishes", a)
        ok(b["state"] == "cancelled" and not os.path.exists(os.path.join(DIRS["diffusion_models"], "same.safetensors")), "and the cancelled one doesn't", b)
        del GATES["same.safetensors"]
        st, r = await post("/valis/models/fetch/cancel", name="nothing.safetensors")
        ok(st == 200 and r["ok"] is False, "cancelling what isn't there is fine", r)
        st, r = await post("/valis/models/fetch/cancel", key="loras/same.safetensors")
        ok(st == 200 and r["ok"], "a download is cancelled by its key too", r)
        reset()

        # ---- who may ask: this machine's own pages only
        r = await c.post("/valis/models/fetch", json={"repo": "a/b", "path": "o.safetensors", "folder": "loras", "size": 5}, headers={"Origin": "https://evil.example"})
        ok(r.status == 403 and not mr.JOBS, "a page of another site can't start a download", (r.status, list(mr.JOBS)))
        r = await c.post("/valis/models/fetch/cancel", json={"name": "x"}, headers={"Origin": "http://localhost:9"})
        ok(r.status == 403, "or stop one", r.status)
        r = await c.get("/valis/models/fetch", headers={"Origin": "null"})
        ok(r.status == 403, "or read the list (a null origin included)", r.status)
        FILES["o.safetensors"] = b"o" * 5
        r = await c.post("/valis/models/fetch", json={"repo": "a/b", "path": "o.safetensors", "folder": "loras", "size": 5}, headers={"Origin": f"http://{host}"})
        ok(r.status == 200 and (await r.json())["started"], "the studio's own page can", r.status)
        await settle("loras/o.safetensors")
        reset()
        os.environ["VALIS_ALLOW_REMOTE_FETCH"] = "1"
        r = await c.post("/valis/models/fetch", json={"repo": "a/b", "path": "o.safetensors", "folder": "loras", "size": 5}, headers={"Origin": "https://studio.example"})
        os.environ.pop("VALIS_ALLOW_REMOTE_FETCH")
        ok(r.status == 200, "VALIS_ALLOW_REMOTE_FETCH=1 lets another page in", r.status)
        await settle("loras/o.safetensors")
        reset()

        def asks(remote, origin=None, host="127.0.0.1:8188"):
            req = types.SimpleNamespace(remote=remote, headers={"Origin": origin} if origin else {}, host=host)
            try:
                mr.guard(req)
                return True
            except web.HTTPForbidden:
                return False
        ok(asks("127.0.0.1") and asks("::1") and asks("::ffff:127.0.0.1") and asks(None), "this machine's own addresses are let in")
        ok(asks("127.0.0.1", "http://127.0.0.1:8188") and asks("::1", "http://localhost:8188", host="localhost:8188"), "(with their own origin)")
        ok(not asks("192.168.1.20") and not asks("203.0.113.7") and not asks("fe80::1%eth0") and not asks("not an address"), "an address on the network is not")
        os.environ["VALIS_ALLOW_REMOTE_FETCH"] = "1"
        ok(asks("192.168.1.20", "http://192.168.1.20:8188", host="192.168.1.20:8188"), "unless VALIS_ALLOW_REMOTE_FETCH=1")
        os.environ.pop("VALIS_ALLOW_REMOTE_FETCH")


asyncio.run(main())
print(f"{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
