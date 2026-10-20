"""Comfy API v2 on this ComfyUI's own origin.

The studio runs every job through the official Comfy SDK (`@comfyorg/sdk`, bundled in app/vendor). The SDK speaks
Comfy API v2, which a self-hosted ComfyUI gets from Comfy-Org's `comfy-api-proxy`. Instead of running the proxy as a
second server on :8189, we mount its routes on ComfyUI's own server, so `/api/v2/*` lives next to `/prompt`:
same origin, no CORS, nothing extra to start. The same studio code runs against Comfy Cloud or a Comfy API
deployment by pointing the SDK at that base URL instead.

If ComfyUI ever serves /api/v2 itself, we leave it alone.
"""
from __future__ import annotations

V2 = "/api/v2/"


def comfyui_url() -> str:
    """The URL the proxy uses to reach this ComfyUI's native API."""
    try:
        from comfy.cli_args import args
        host = (args.listen or "127.0.0.1").split(",")[0].strip()
        if host in ("0.0.0.0", "::", ""):
            host = "127.0.0.1"
        if ":" in host and not host.startswith("["):
            host = f"[{host}]"
        scheme = "https" if getattr(args, "tls_keyfile", None) else "http"
        return f"{scheme}://{host}:{args.port}"
    except Exception:
        return "http://127.0.0.1:8188"


def _fix_stream_view(proxy_cls) -> None:
    """comfy-api-proxy 0.1.6 streams an output by reading ComfyUI's own /view, but never releases that upstream
    response when the client goes away mid-stream (a <video> seeking or closing does this constantly). The leaked
    responses leave ComfyUI's file sends blocked until a restart. Same code, with the release in a finally."""
    if getattr(proxy_cls._stream_view, "_valis", False):
        return
    from aiohttp import web
    from comfy_api_proxy.app import _error

    async def _stream_view(self, request, ref):
        params = {"filename": ref["filename"], "subfolder": ref.get("subfolder", ""), "type": ref.get("type", "output")}
        headers = {"Range": request.headers["Range"]} if "Range" in request.headers else {}
        try:
            upstream = await self.session.get(self.comfyui + "/view", params=params, headers=headers)
        except Exception:
            return _error(500, "upstream_error", "Failed to reach ComfyUI for content.")
        out = None
        try:
            if upstream.status not in (200, 206):
                if upstream.status == 404:
                    return _error(404, "output_unavailable", "Output bytes are no longer retrievable upstream. "
                                  "Retrying cannot help; re-execute with a changed prompt hash.")
                return _error(502, "upstream_error", "ComfyUI returned an unexpected status for the output.")
            out = web.StreamResponse(status=upstream.status)
            out.content_type = upstream.content_type
            for h in ("Content-Length", "Content-Range", "Accept-Ranges"):
                if h in upstream.headers:
                    out.headers[h] = upstream.headers[h]
            await out.prepare(request)
            async for chunk in upstream.content.iter_chunked(1 << 16):
                await out.write(chunk)
            await out.write_eof()
            return out
        except ConnectionResetError:  # the viewer went away (a seek or a closed tab): nothing to report
            return out if out is not None else web.Response(status=499)
        finally:
            upstream.close()          # closes the upstream connection even when the client left mid-stream

    _stream_view._valis = True
    proxy_cls._stream_view = _stream_view


def mount(routes, app, url: str | None = None) -> bool:
    """Register comfy-api-proxy's v2 routes on `routes` (a RouteTableDef the server adds later) and its session
    startup/cleanup on `app`. Returns False (and changes nothing) if the proxy isn't installed or v2 already exists."""
    try:
        from comfy_api_proxy.app import make_app
    except ImportError:
        print("[valis] comfy-api-proxy is not installed: pip install comfy-api-proxy (the studio needs it to run jobs)")
        return False
    taken = {getattr(r, "path", "") for r in routes}
    taken |= {getattr(getattr(r, "resource", None), "canonical", "") for r in app.router.routes()}
    if any(p in ("/api/v2/jobs", "/api/v2/health") for p in taken):    # (other packs use /api/v2/<their name>/...)
        print("[valis] /api/v2 is already served here; using it")
        return True
    from comfy_api_proxy.app import Proxy
    _fix_stream_view(Proxy)
    sub = make_app(url or comfyui_url())
    found = [(r.method, r.resource.canonical, r.handler) for r in sub.router.routes() if r.resource.canonical.startswith(V2)]
    gets = {p for m, p, _ in found if m == "GET"}
    n = 0
    for method, path, handler in found:
        if method == "HEAD" and path in gets:      # registering the GET adds its HEAD again
            continue
        routes.route(method, path)(handler)
        n += 1
    own = lambda fn: type(getattr(fn, "__self__", None)).__name__ != "CleanupContext"   # skip aiohttp's built-ins
    for fn in filter(own, sub.on_startup):
        app.on_startup.append(fn)
    for fn in filter(own, sub.on_cleanup):
        app.on_cleanup.append(fn)
    print(f"[valis] Comfy API v2 mounted ({n} routes) for the Comfy SDK")
    return True
