"""ComfyUI-Valis: an open studio for ComfyUI.

Serves a Higgsfield-style creative front end at http://127.0.0.1:8188/valis. Every job goes through the official
Comfy SDK (@comfyorg/sdk) and Comfy API v2, which this pack mounts on ComfyUI's own server from Comfy-Org's
comfy-api-proxy (sdk_api.py): same origin, no CORS, no second server.

Tabs:
  Stage   - one still, split by words into depth layers (SAM 3 + Depth Anything 3), played by a live 2.5D camera
  Create  - a director's panel (genre, camera, lens, light, grade) -> keyframe (Krea 2) -> shot (MiniMax H3 i2v)
  Edit    - point at anything in a clip by name (SAM 3) and Transform / Remove / Swap it (Krea or Qwen anchors ->
            H3 masked re-render)
  Score   - the Valis part: a score's event map drives the effects (reveal on the kick, flare on the response...)
  Renders - the queue and everything the studio has made
"""
import os
import sys

WEB_DIRECTORY = "./web"          # only a small menu button is injected into the ComfyUI graph editor
NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

APP_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "app")

try:
    from .nodes import NODE_CLASS_MAPPINGS as _N, NODE_DISPLAY_NAME_MAPPINGS as _D
    NODE_CLASS_MAPPINGS.update(_N)
    NODE_DISPLAY_NAME_MAPPINGS.update(_D)
except Exception as e:                       # the studio must load even if an optional node fails
    print(f"[valis] nodes not loaded: {e}")

try:
    from .nodes_stage import NODE_CLASS_MAPPINGS as _NS, NODE_DISPLAY_NAME_MAPPINGS as _DS
    NODE_CLASS_MAPPINGS.update(_NS)
    NODE_DISPLAY_NAME_MAPPINGS.update(_DS)
except Exception as e:
    print(f"[valis] stage node not loaded: {e}")

try:
    from .nodes_lib import NODE_CLASS_MAPPINGS as _NL, NODE_DISPLAY_NAME_MAPPINGS as _DL
    NODE_CLASS_MAPPINGS.update(_NL)
    NODE_DISPLAY_NAME_MAPPINGS.update(_DL)
except Exception as e:
    print(f"[valis] library nodes not loaded: {e}")

if sys.platform == "win32":
    # Desktop Windows runs at most two TransmitFile (sendfile) transfers at once, system-wide; the rest wait. A
    # <video> that has buffered enough stops reading and keeps its transfer open, so two such players stall every
    # file ComfyUI serves (/view, the studio's own scripts) until they close. aiohttp's own switch for this sends
    # files with plain reads and writes instead.
    try:
        import aiohttp.web_fileresponse as _wf
        _wf.NOSENDFILE = True
    except Exception as e:
        print(f"[valis] could not disable sendfile: {e}")

try:
    import server
    from aiohttp import web

    routes = server.PromptServer.instance.routes

    @routes.get("/valis")
    async def valis_index(request):
        return web.FileResponse(os.path.join(APP_DIR, "index.html"), headers={"Cache-Control": "no-cache"})

    APP_ROOT = os.path.realpath(APP_DIR)

    @routes.get("/valis/app/{path:.*}")
    async def valis_static(request):
        # no-cache = revalidate every load (a 304 when unchanged), so an updated studio never runs stale modules
        full = os.path.realpath(os.path.join(APP_ROOT, request.match_info["path"]))
        if not full.startswith(APP_ROOT + os.sep) or not os.path.isfile(full):
            raise web.HTTPNotFound()
        return web.FileResponse(full, headers={"Cache-Control": "no-cache"})

    print("[valis] studio at /valis")

    try:
        from .stage_routes import register as _stage_routes
        _stage_routes(routes)
    except Exception as e:
        print(f"[valis] stage routes not registered: {e}")

    try:
        from .model_routes import register as _model_routes
        _model_routes(routes)
    except Exception as e:
        print(f"[valis] model routes not registered: {e}")

    from .sdk_api import mount
    mount(routes, server.PromptServer.instance.app)
except Exception as e:
    print(f"[valis] studio route not registered: {e}")

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
