"""The Stage tab's export routes (stage_routes.py), run for real on an aiohttp server with a stand-in for PyAV and ComfyUI's
folder_paths: encoding and the audio decoder run off the loop that serves ComfyUI's HTTP and websocket, and an export that
fails, repeats its job id, is aborted or goes quiet is closed and its half-written video deleted (needs aiohttp; no ComfyUI).

    python3 tests/check_stage_routes.py
"""
import asyncio
import io
import logging
import os
import sys
import tempfile
import threading
import time
import types

import numpy as np

try:
    from aiohttp import web
    from aiohttp.test_utils import TestClient, TestServer
except ImportError:
    print("check_stage_routes: needs aiohttp (pip install aiohttp); skipped")
    sys.exit(0)

logging.getLogger("aiohttp.server").setLevel(logging.CRITICAL)      # (the failures it makes on purpose are logged there)
repo = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
passed = failed = 0


def ok(cond, name, detail=""):
    global passed, failed
    if cond:
        passed += 1
    else:
        failed += 1
        print(f"FAIL {name}{': ' + str(detail) if detail not in (None, '') else ''}")


OUT = tempfile.mkdtemp()
IN = tempfile.mkdtemp()
TMP = tempfile.mkdtemp()
fp = types.ModuleType("folder_paths")
fp.get_output_directory = lambda: OUT
fp.get_input_directory = lambda: IN
fp.get_temp_directory = lambda: TMP


def _annotated(name):                      # as ComfyUI's: "x [output]" / "x [temp]" name another folder, and the join confines nothing
    for tag, base in (("[output]", OUT), ("[input]", IN), ("[temp]", TMP)):
        if name.endswith(tag):
            return os.path.join(base, name[:-len(tag)].rstrip())
    return os.path.join(IN, name)


fp.get_annotated_filepath = _annotated
sys.modules["folder_paths"] = fp

# ---- a stand-in PyAV: files appear and close, and every call that would block says which thread made it
THREADS = []                       # (what, thread id)
CONTAINERS = []
BREAK = {"encode": False}


class Stream:
    def __init__(self):
        self.options = {}

    def encode(self, frame=None):
        THREADS.append(("encode", threading.get_ident()))
        if BREAK["encode"]:
            raise RuntimeError("encoder broke")
        return [b"packet"] if frame is not None else []


class Container:
    def __init__(self, path):
        self.path, self.closed, self.muxed = path, False, 0
        with open(path, "wb") as f:
            f.write(b"mp4")
        CONTAINERS.append(self)

    def add_stream(self, codec, rate=None):
        return Stream()

    def mux(self, packet):
        THREADS.append(("mux", threading.get_ident()))
        self.muxed += 1

    def close(self):
        self.closed = True

    def __enter__(self):
        return self

    def __exit__(self, *a):
        self.close()


OPENED = []                        # every path the audio decoder was asked to open


class Audio:
    def __init__(self, path):
        self.f = open(path, "rb")                                     # a missing file raises, as PyAV's does

    def __enter__(self):
        return self

    def __exit__(self, *a):
        self.f.close()

    def decode(self, audio=0):
        return [object()]


class Resampler:
    def __init__(self, format=None, layout=None, rate=None):
        pass

    def resample(self, frame):
        return [types.SimpleNamespace(to_ndarray=lambda: np.zeros((1, 100), np.float32))] if frame is not None else []


def av_open(path, mode="r"):
    if mode == "r":
        THREADS.append(("open audio", threading.get_ident()))
        OPENED.append(os.path.realpath(path))
        return Audio(path)
    return Container(path)


av = types.ModuleType("av")
av.open = av_open
av.AudioResampler = Resampler
av.VideoFrame = types.SimpleNamespace(from_ndarray=lambda im, format=None: im)
sys.modules["av"] = av

pkg = types.ModuleType("valispkg")                                    # the repo as a package, without running its __init__ (torch)
pkg.__path__ = [os.path.abspath(repo)]
sys.modules["valispkg"] = pkg
from valispkg import stage_routes  # noqa: E402
from valispkg.valis_fx.lib import cues as cues_mod  # noqa: E402

orig_from_schedule = cues_mod.Cues.from_schedule.__func__


def _from_schedule(cls, *a, **k):
    THREADS.append(("cues", threading.get_ident()))
    return orig_from_schedule(cls, *a, **k)


cues_mod.Cues.from_schedule = classmethod(_from_schedule)


def px(w, h):
    return np.zeros((h, w, 4), np.uint8).tobytes()


def jpeg():
    from PIL import Image
    b = io.BytesIO()
    Image.fromarray(np.zeros((4, 4, 3), np.uint8)).save(b, "JPEG")
    return b.getvalue()


def mp4s():
    d = os.path.join(OUT, "valis", "stage")
    return sorted(f for f in os.listdir(d) if f.endswith(".mp4")) if os.path.isdir(d) else []


async def main():
    me = threading.get_ident()
    app = web.Application()
    routes = web.RouteTableDef()
    stage_routes.register(routes)
    app.add_routes(routes)
    async with TestClient(TestServer(app)) as c:
        async def post(path, **kw):
            r = await c.post(path, **kw)
            try:
                return r.status, await r.json()
            except Exception:
                return r.status, None

        async def begin(job, **kw):
            return await post("/valis/stage/begin", json={"job": job, "width": 4, "height": 2, "fps": 24, "name": kw.pop("name", "move"), **kw})

        async def raw(job, n=1, w=4, h=2, data=None):
            last = None
            for _ in range(n):
                last = await post(f"/valis/stage/raw?job={job}&w={w}&h={h}", data=data if data is not None else px(w, h))
            return last

        # a whole export: begin, frames, finish
        st, b = await begin("a", name="whole")
        ok(st == 200 and b["filename"] == "whole.mp4" and mp4s() == ["whole.mp4"], "export: begin opens the video", (st, b, mp4s()))
        st, r = await raw("a", 3)
        ok(st == 200 and r["n"] == 3, "export: frames are counted", (st, r))
        st, r = await post("/valis/stage/finish", json={"job": "a"})
        ok(st == 200 and r["frames"] == 3 and mp4s() == ["whole.mp4"] and CONTAINERS[-1].closed, "export: finish closes the video and keeps it", (st, r, mp4s()))
        ok(THREADS and all(t != me for _, t in THREADS), "export: the encoder ran off the server's loop", [w for w, t in THREADS if t == me])
        ok((await post("/valis/stage/finish", json={"job": "a"}))[0] == 404, "export: a finished job is gone")

        # frames that aren't the size they say, and a job nobody began
        await begin("sz", name="sz")
        ok((await raw("sz", data=b"abc"))[0] == 400, "export: a frame of the wrong size is a 400, not a 500")
        ok((await raw("nobody"))[0] == 404, "export: a frame for no job is a 404")
        await post("/valis/stage/abort", json={"job": "sz"})

        # abort: the video is closed and deleted, and so are the jpeg frames of the fallback
        st, b = await begin("b", name="aborted")
        await raw("b", 2)
        ct = CONTAINERS[-1]
        await post("/valis/stage/frame?job=b&i=0", data=jpeg())
        ok(os.path.isdir(os.path.join(OUT, "valis", "stage", "_frames", "b")), "abort: (a jpeg frame is waiting)")
        st, r = await post("/valis/stage/abort", json={"job": "b"})
        ok(st == 200 and r["dropped"] and ct.closed and "aborted.mp4" not in mp4s(), "abort: closes the open video and deletes the half-written file", (st, r, mp4s()))
        ok(not os.path.exists(os.path.join(OUT, "valis", "stage", "_frames", "b")), "abort: and the jpeg frames")
        ok((await post("/valis/stage/finish", json={"job": "b"}))[0] == 404, "abort: the job is gone")
        st, r = await post("/valis/stage/abort", json={"job": "never"})
        ok(st == 200 and r["dropped"] is False, "abort: a job that isn't there is fine")
        ok((await post("/valis/stage/abort", json={"job": "../x"}))[0] == 400, "abort: a bad job id is a 400")

        # begin twice with the same id: the first is dropped, not left open for the life of the process
        await begin("c", name="twice")
        first = CONTAINERS[-1]
        await raw("c", 2)
        st, b = await begin("c", name="twice")
        second = CONTAINERS[-1]
        ok(first is not second and first.closed and not second.closed, "begin twice: the first export is closed", (first.closed, second.closed))
        ok(mp4s().count("twice.mp4") == 1 and b["filename"] == "twice.mp4" and os.path.exists(second.path), "begin twice: its file is gone and the second has the name", (mp4s(), b))
        await raw("c", 1)
        st, r = await post("/valis/stage/finish", json={"job": "c"})
        ok(r["frames"] == 1, "begin twice: the video is the second one's alone", r)

        # an export nobody feeds is dropped the next time one begins
        old = stage_routes.IDLE_SECONDS
        stage_routes.IDLE_SECONDS = 0.05
        await begin("d", name="idle")
        idle = CONTAINERS[-1]
        await asyncio.sleep(.15)
        await begin("e", name="fresh")
        ok(idle.closed and "idle.mp4" not in mp4s() and "fresh.mp4" in mp4s(), "idle: an export that went quiet is closed and deleted", mp4s())
        ok((await raw("d"))[0] == 404, "idle: and its job is gone")
        stage_routes.IDLE_SECONDS = old
        await post("/valis/stage/abort", json={"job": "e"})

        # a start that fails (an audio file that isn't there) leaves no open video and no empty .mp4
        before = list(mp4s()); n_before = len(CONTAINERS)
        st, _ = await begin("f", name="noaudio", audio="missing.wav")
        ok(st == 500 and mp4s() == before and all(x.closed for x in CONTAINERS[n_before:]), "begin: a failed start closes its video and deletes the file", (st, mp4s()))
        ok(("open audio", me) not in THREADS, "begin: the audio decoder ran off the server's loop")
        ok((await begin("g", width=0))[0] == 400 and (await begin("g", width="wide"))[0] == 400, "begin: a bad size is a 400")

        # an encoder that breaks ends the export
        await begin("h", name="broken")
        ct = CONTAINERS[-1]
        BREAK["encode"] = True
        st, _ = await raw("h")
        BREAK["encode"] = False
        ok(st == 500 and ct.closed and "broken.mp4" not in mp4s(), "raw: a frame that won't encode closes the export and deletes its file", (st, mp4s()))
        ok((await raw("h"))[0] == 404, "raw: and the job is gone")

        # an audio name stays inside ComfyUI's folders: "../x" and "/x" would otherwise reach any file the server can read
        outside = tempfile.mkdtemp()
        secret = os.path.join(outside, "secret.wav")
        open(secret, "wb").write(b"RIFF")
        os.makedirs(os.path.join(IN, "sub"), exist_ok=True)
        os.makedirs(os.path.join(OUT, "valis"), exist_ok=True)
        os.makedirs(os.path.join(TMP, "t"), exist_ok=True)
        for p in (os.path.join(IN, "sub", "ok.wav"), os.path.join(OUT, "valis", "made.wav"), os.path.join(TMP, "t", "tmp.wav")):
            open(p, "wb").write(b"RIFF")
        n_open = len(OPENED)
        await post("/valis/stage/frame?job=audj&i=0", data=jpeg())
        reach = {"a relative path out of input": os.path.relpath(secret, IN), "an absolute path": secret,
                 "a path out of input through a subfolder": "sub/../../" + os.path.relpath(secret, os.path.dirname(IN)),
                 "an absolute path with [output]": secret + " [output]", "an empty name": "  ", "a name with NUL": "a\0.wav", "input itself": "."}
        link = os.path.join(IN, "link.wav")
        try:
            os.symlink(secret, link)
            reach["a symlink in input to a file outside"] = "link.wav"
        except (OSError, NotImplementedError):
            pass
        for what, name in reach.items():
            st, _ = await post("/valis/stage/cues", json={"audio": name, "kind": "none"})
            ok(st == 400, f"audio name: {what} is refused (cues)", (st, name))
            before = list(mp4s())
            st, _ = await begin("aud", name="audbad", audio=name)
            ok(st == 400 and mp4s() == before, f"audio name: {what} is refused (begin), with no video left", (st, mp4s()))
            st, _ = await post("/valis/stage/encode", json={"job": "audj", "fps": 24, "name": "audbad", "audio": name})
            ok(st == 400 and "audbad.mp4" not in mp4s(), f"audio name: {what} is refused (encode), with no video left", (st, mp4s()))
        ok(len(OPENED) == n_open, "audio name: nothing outside ComfyUI's folders was opened", OPENED[n_open:])
        for what, name in {"a file in input": "sub/ok.wav", "a file in input, tagged": "sub/ok.wav [input]", "a file in output": "valis/made.wav [output]",
                           "a file in temp": "t/tmp.wav [temp]"}.items():
            st, r = await post("/valis/stage/cues", json={"audio": name, "kind": "none"})
            ok(st == 200 and abs(r["duration"] - 100 / 44100) < 1e-9, f"audio name: {what} is read", (st, r))
        st, _ = await begin("audok", name="audok", audio="sub/ok.wav")
        ok(st == 200 and OPENED[-1] == os.path.realpath(os.path.join(IN, "sub", "ok.wav")), "audio name: a begin with a good name opens it", (st, OPENED[-1:]))
        await post("/valis/stage/abort", json={"job": "audok"})

        # the other blocking routes: cue analysis and the jpeg encode
        mark = len(THREADS)
        st, r = await post("/valis/stage/cues", json={"sheet": "bpm 120 4/4\n1:1 kick"})
        ok(st == 200 and len(r["lanes"].get("kick", [])) == 1, "cues: a cue sheet still comes back", (st, r))
        ok(any(w == "cues" and t != me for w, t in THREADS[mark:]) and all(t != me for w, t in THREADS[mark:]), "cues: the analysis ran off the server's loop")
        for i in range(2):
            await post(f"/valis/stage/frame?job=j&i={i}", data=jpeg())
        mark = len(THREADS)
        st, r = await post("/valis/stage/encode", json={"job": "j", "fps": 24, "name": "jpegs"})
        ok(st == 200 and r["frames"] == 2 and "jpegs.mp4" in mp4s() and THREADS[mark:] and all(t != me for w, t in THREADS[mark:]), "encode: the jpeg encode ran off the server's loop and made the video", (st, r))
        ok(not os.path.exists(os.path.join(OUT, "valis", "stage", "_frames", "j")), "encode: and cleared the frames")
        for i in range(2):
            await post(f"/valis/stage/frame?job=k&i={i}", data=jpeg())
        BREAK["encode"] = True
        st, _ = await post("/valis/stage/encode", json={"job": "k", "fps": 24, "name": "jpegfail"})
        BREAK["encode"] = False
        ok(st == 500 and "jpegfail.mp4" not in mp4s(), "encode: an encode that fails leaves no half-written video", (st, mp4s()))


asyncio.run(main())
print(f"{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
