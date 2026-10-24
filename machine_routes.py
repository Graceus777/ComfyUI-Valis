"""GET /valis/machine: what this machine is, for the studio's Machine panel and its safe defaults.

ComfyUI's /system_stats has the GPU's name and memory, PyTorch's version and the launch flags. This adds what it
doesn't say: the NVIDIA driver and the CUDA version it supports (nvidia-smi), PyTorch's CUDA and cuDNN builds, the
GPU's compute capability (fp8 needs 8.9+), which attention kernels are installed (SageAttention, FlashAttention,
xformers, Triton) and which one ComfyUI is using, and ComfyUI's memory mode. Nothing leaves the machine.
"""
import importlib.metadata
import importlib.util
import platform
import re
import shutil
import subprocess
import sys

from aiohttp import web


def _run(cmd, timeout=6):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout,
                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        return r.stdout if r.returncode == 0 else ""
    except Exception:
        return ""


def _nvidia():
    exe = shutil.which("nvidia-smi")
    if not exe:
        return None
    q = _run([exe, "--query-gpu=name,driver_version,memory.total,memory.used,temperature.gpu,power.limit,pcie.link.gen.current,pcie.link.width.current",
              "--format=csv,noheader,nounits"])
    gpus = []
    for row in q.strip().splitlines():
        p = [x.strip() for x in row.split(",")]
        if len(p) >= 8:
            gpus.append({"name": p[0], "driver": p[1], "memory_mb": _num(p[2]), "used_mb": _num(p[3]), "temp_c": _num(p[4]),
                         "power_limit_w": _num(p[5]), "pcie_gen": _num(p[6]), "pcie_width": _num(p[7])})
    head = _run([exe])
    m = re.search(r"CUDA Version:\s*([\d.]+)", head)
    return {"gpus": gpus, "driver_cuda": m.group(1) if m else None}


def _num(x):
    try:
        return float(x)
    except Exception:
        return None


def _ver(pkg):
    try:
        return importlib.metadata.version(pkg)
    except Exception:
        return None


def _has(mod):
    try:
        return importlib.util.find_spec(mod) is not None
    except Exception:
        return False


def machine():
    out = {"python": sys.version.split()[0], "os": platform.platform(), "nvidia": _nvidia()}
    try:
        import torch
        out["torch"] = torch.__version__
        out["torch_cuda"] = torch.version.cuda
        out["cudnn"] = torch.backends.cudnn.version() if torch.backends.cudnn.is_available() else None
        if torch.cuda.is_available():
            pr = torch.cuda.get_device_properties(0)
            out["gpu"] = {"name": pr.name, "memory_gb": round(pr.total_memory / 2 ** 30, 1), "capability": f"{pr.major}.{pr.minor}",
                          "sms": pr.multi_processor_count, "bf16": bool(torch.cuda.is_bf16_supported()), "fp8": (pr.major, pr.minor) >= (8, 9)}
    except Exception as e:
        out["torch_error"] = str(e)
    out["kernels"] = {name: {"installed": _has(mod), "version": _ver(pkg)} for name, mod, pkg in [
        ("SageAttention", "sageattention", "sageattention"), ("FlashAttention", "flash_attn", "flash-attn"), ("xformers", "xformers", "xformers"),
        ("Triton", "triton", "triton-windows" if sys.platform == "win32" and _ver("triton-windows") else "triton"), ("comfy-kitchen", "comfy_kitchen", "comfy-kitchen")]}
    try:
        import comfy.model_management as mm
        from comfy.cli_args import args
        def call(fn):
            f = getattr(mm, fn, None)
            try:
                return bool(f()) if callable(f) else None
            except Exception:
                return None
        out["comfy"] = {
            "vram_state": getattr(getattr(mm, "vram_state", None), "name", None),
            "attention": next((n for n, fn in [("sage", "sage_attention_enabled"), ("flash", "flash_attention_enabled"), ("xformers", "xformers_enabled"),
                                                 ("pytorch", "pytorch_attention_enabled")] if call(fn)), "split"),
            "flags": {k: v for k, v in sorted(vars(args).items()) if v not in (None, False, [], "") and not k.endswith("directory") and k not in ("listen",)},
        }
        try:
            out["comfy"]["ram_gb"] = round(mm.get_total_memory(mm.torch.device("cpu")) / 2 ** 30, 1)
        except Exception:
            pass
    except Exception as e:
        out["comfy_error"] = str(e)
    try:
        import psutil
        vm = psutil.virtual_memory()
        out["ram"] = {"total_gb": round(vm.total / 2 ** 30, 1), "free_gb": round(vm.available / 2 ** 30, 1)}
        sw = psutil.swap_memory()
        out["swap_gb"] = round(sw.total / 2 ** 30, 1)
    except Exception:
        pass
    return out


def register(routes):
    @routes.get("/valis/machine")
    async def machine_route(request):
        import asyncio
        return web.json_response(await asyncio.get_running_loop().run_in_executor(None, machine))
