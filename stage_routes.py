"""Routes for the Stage tab: list stage folders, take the frames the browser renders, encode them with ComfyUI's own
PyAV (the same h264 encoder SaveVideo uses). Frames never leave this machine."""
import json
import os
import re
import shutil

from aiohttp import web


def register(routes):
    import folder_paths

    def out_dir():
        return os.path.realpath(folder_paths.get_output_directory())

    def stage_root():
        return os.path.join(out_dir(), "valis", "stage")

    def frames_dir(job):
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", job or ""):
            raise web.HTTPBadRequest(text="bad job id")
        return os.path.join(stage_root(), "_frames", job)

    @routes.get("/valis/stage/list")
    async def stage_list(request):
        root = stage_root()
        items = []
        if os.path.isdir(root):
            for d in sorted(os.listdir(root), reverse=True):
                f = os.path.join(root, d, "stage.json")
                if d.startswith("_") or not os.path.isfile(f):
                    continue
                try:
                    with open(f) as fh:
                        m = json.load(fh)
                    items.append({"name": d, "subfolder": f"valis/stage/{d}", "layers": len(m.get("layers", [])),
                                  "names": [l["name"] for l in m.get("layers", [])]})
                except Exception:
                    continue
        return web.json_response({"stages": items})

    sessions = {}

    @routes.post("/valis/stage/begin")
    async def stage_begin(request):
        """Open a streaming h264 encoder (PyAV): the browser then posts raw RGBA frames (gl.readPixels), which are
        encoded as they arrive, so nothing is stored per frame and no JPEG is made in the browser."""
        import av
        q = await request.json()
        job = q.get("job")
        frames_dir(job)                                    # validates the id
        sub = q.get("subfolder") or "valis/stage"
        target = os.path.realpath(os.path.join(out_dir(), sub))
        if not target.startswith(out_dir() + os.sep):
            raise web.HTTPBadRequest(text="bad subfolder")
        os.makedirs(target, exist_ok=True)
        name = re.sub(r"[^A-Za-z0-9_.-]+", "_", q.get("name") or "move")
        k, fn = 1, f"{name}.mp4"
        while os.path.exists(os.path.join(target, fn)):
            k += 1
            fn = f"{name}_{k}.mp4"
        w, h, fps = int(q["width"]) // 2 * 2, int(q["height"]) // 2 * 2, int(q.get("fps", 24))
        out = av.open(os.path.join(target, fn), mode="w")
        st = out.add_stream("h264", rate=fps)
        st.width, st.height, st.pix_fmt = w, h, "yuv420p"
        st.options = {"crf": "16", "preset": "fast"}
        audio, ast = None, None
        if q.get("audio"):
            y, sr, _ = read_audio(q["audio"])
            a0 = int(float(q.get("audio_offset", 0)) * sr)
            y = y[a0:a0 + int(float(q.get("seconds", 0)) * sr)] if q.get("seconds") else y[a0:]
            if len(y):
                audio = (y, sr)
                ast = out.add_stream("aac", rate=sr)
                ast.layout = "mono"
        sessions[job] = {"out": out, "st": st, "ast": ast, "audio": audio, "w": w, "h": h, "n": 0, "fn": fn, "sub": sub}
        return web.json_response({"ok": True, "filename": fn})

    @routes.post("/valis/stage/raw")
    async def stage_raw(request):
        import av
        import numpy as np
        S = sessions.get(request.query.get("job"))
        if S is None:
            raise web.HTTPNotFound(text="no such export")
        w, h = int(request.query["w"]), int(request.query["h"])
        body = await request.read()
        im = np.frombuffer(body, np.uint8).reshape(h, w, 4)[::-1, :, :3]      # readPixels is bottom-up
        im = np.ascontiguousarray(im[:S["h"], :S["w"]])
        for p in S["st"].encode(av.VideoFrame.from_ndarray(im, format="rgb24")):
            S["out"].mux(p)
        S["n"] += 1
        return web.json_response({"ok": True, "n": S["n"]})

    @routes.post("/valis/stage/finish")
    async def stage_finish(request):
        import av
        import numpy as np
        q = await request.json()
        S = sessions.pop(q.get("job"), None)
        if S is None:
            raise web.HTTPNotFound(text="no such export")
        out, st, ast = S["out"], S["st"], S["ast"]
        for p in st.encode():
            out.mux(p)
        if ast is not None:
            y, sr = S["audio"]
            y = y[:int(S["n"] / float(st.rate) * sr)].astype(np.float32)
            for i in range(0, len(y), 1024):
                fr = av.AudioFrame.from_ndarray(np.ascontiguousarray(y[None, i:i + 1024]), format="fltp", layout="mono")
                fr.sample_rate = sr
                fr.pts = i
                for p in ast.encode(fr):
                    out.mux(p)
            for p in ast.encode():
                out.mux(p)
        out.close()
        return web.json_response({"filename": S["fn"], "subfolder": S["sub"], "frames": S["n"]})

    @routes.post("/valis/stage/frame")
    async def stage_frame(request):
        d = frames_dir(request.query.get("job"))
        i = int(request.query.get("i", "0"))
        os.makedirs(d, exist_ok=True)
        body = await request.read()
        if len(body) > 40 * 1024 * 1024:
            raise web.HTTPRequestEntityTooLarge(max_size=40 * 1024 * 1024, actual_size=len(body))
        with open(os.path.join(d, f"{i:06d}.jpg"), "wb") as f:
            f.write(body)
        return web.json_response({"ok": True})

    def read_audio(name):
        """An uploaded input file -> mono float32 at 44.1 kHz (PyAV, as ComfyUI loads audio)."""
        import av
        import numpy as np
        path = folder_paths.get_annotated_filepath(name)
        out = []
        with av.open(path) as c:
            rs = av.AudioResampler(format="flt", layout="mono", rate=44100)
            for fr in c.decode(audio=0):
                for r in rs.resample(fr):
                    out.append(r.to_ndarray().reshape(-1))
            for r in rs.resample(None):
                out.append(r.to_ndarray().reshape(-1))
        return (np.concatenate(out) if out else np.zeros(1, np.float32)), 44100, path

    @routes.post("/valis/stage/cues")
    async def stage_cues(request):
        """Lanes for the stage: music (kick, snare, hat, onset, beat, downbeat + curves), a voice (syllable), and/or a
        soundless cue sheet. Same engine as the FX library (valis_fx/lib/cues.py)."""
        from .valis_fx.lib.cues import Cues
        q = await request.json()
        lanes, vals, dur = {}, {}, 0.0
        if q.get("audio"):
            y, sr, _ = read_audio(q["audio"])
            dur = len(y) / sr
            if q.get("kind", "music") in ("music", "both"):
                c = Cues.from_audio(y, sr).to_json()
                lanes.update(c["lanes"]); vals.update(c["vals"])
            if q.get("kind", "music") in ("voice", "both"):
                from .nodes import speech_onsets
                on, _ = speech_onsets(y / (abs(y).max() + 1e-9), sr)
                lanes["syllable"] = on; vals["syllable"] = [1.0] * len(on)
        if (q.get("sheet") or "").strip():
            c = Cues.from_schedule(q["sheet"], duration=q.get("duration")).to_json()
            lanes.update(c["lanes"]); vals.update(c["vals"])
            dur = max(dur, float(c.get("duration") or 0))
        # a waveform overview for the strip (peak per 1/50 s)
        wave = []
        if q.get("audio"):
            import numpy as np
            n = max(1, int(sr / 50))
            k = len(y) // n
            wave = [round(float(x), 3) for x in np.abs(y[:k * n]).reshape(k, n).max(1)] if k else []
        return web.json_response({"lanes": lanes, "vals": vals, "duration": dur, "wave": wave})

    @routes.post("/valis/stage/encode")
    async def stage_encode(request):
        import av
        import numpy as np
        from PIL import Image
        q = await request.json()
        d = frames_dir(q.get("job"))
        fps = int(q.get("fps", 24))
        sub = q.get("subfolder") or "valis/stage"
        target = os.path.realpath(os.path.join(out_dir(), sub))
        if not target.startswith(out_dir() + os.sep):
            raise web.HTTPBadRequest(text="bad subfolder")
        name = re.sub(r"[^A-Za-z0-9_.-]+", "_", q.get("name") or "move")
        files = sorted(f for f in os.listdir(d) if f.endswith(".jpg"))
        if not files:
            return web.json_response({"error": "no frames"})
        os.makedirs(target, exist_ok=True)
        k, fn = 1, f"{name}.mp4"
        while os.path.exists(os.path.join(target, fn)):
            k += 1
            fn = f"{name}_{k}.mp4"
        audio = None
        if q.get("audio"):
            y, sr, _ = read_audio(q["audio"])
            a0 = int(float(q.get("audio_offset", 0)) * sr)
            y = y[a0:a0 + int(len(files) / fps * sr)]
            audio = (y, sr)
        first = Image.open(os.path.join(d, files[0]))
        w, h = first.size[0] // 2 * 2, first.size[1] // 2 * 2
        with av.open(os.path.join(target, fn), mode="w") as out:
            st = out.add_stream("h264", rate=fps)
            st.width, st.height, st.pix_fmt = w, h, "yuv420p"
            st.options = {"crf": "16", "preset": "medium"}
            ast = None
            if audio is not None and len(audio[0]):
                ast = out.add_stream("aac", rate=audio[1])
                ast.layout = "mono"
            for f in files:
                im = np.asarray(Image.open(os.path.join(d, f)).convert("RGB"))[:h, :w]
                for p in st.encode(av.VideoFrame.from_ndarray(np.ascontiguousarray(im), format="rgb24")):
                    out.mux(p)
            for p in st.encode():
                out.mux(p)
            if ast is not None:
                y = audio[0].astype(np.float32)
                for i in range(0, len(y), 1024):
                    fr = av.AudioFrame.from_ndarray(np.ascontiguousarray(y[None, i:i + 1024]), format="fltp", layout="mono")
                    fr.sample_rate = audio[1]
                    fr.pts = i
                    for p in ast.encode(fr):
                        out.mux(p)
                for p in ast.encode():
                    out.mux(p)
        shutil.rmtree(d, ignore_errors=True)
        return web.json_response({"filename": fn, "subfolder": sub, "frames": len(files)})
