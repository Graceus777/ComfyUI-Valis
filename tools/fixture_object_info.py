"""Trim a ComfyUI /object_info dump to the nodes the studio's graphs use: tests/fixtures/object_info.json.

    python tools/fixture_object_info.py path/to/object_info.json
"""
import glob, json, os, re, sys

here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
full = json.load(open(sys.argv[1]))
out = os.path.join(here, "tests", "fixtures", "object_info.json")
used = set(json.load(open(out))) if os.path.exists(out) else set()
for f in glob.glob(os.path.join(here, "app", "js", "*.js")):
    t = open(f, encoding="utf-8").read()
    used |= set(re.findall(r'N\(\s*"([A-Za-z0-9_ .\-+]+)"', t)) | set(re.findall(r'class_type:\s*"([A-Za-z0-9_ .\-+]+)"', t))
keep = {k: full[k] for k in sorted(used) if k in full}
json.dump(keep, open(out, "w"), separators=(",", ":"))
print(f"{len(keep)} nodes -> {out}; not in this ComfyUI: {sorted(u for u in used if u not in full)}")
