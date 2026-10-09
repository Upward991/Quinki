#!/usr/bin/env python3
"""Neutralize build-machine personal paths baked inside compiled binaries.

Some tools bake absolute build paths into compiled binaries (bun inlines CJS
__dirname; Swift debug info embeds source paths). This replaces the developer's
username with a neutral SAME-LENGTH placeholder: pure in-place byte replacement,
binary layout never changes and runtime behavior is unaffected (the vendored
photon loader already redirects missing wasm reads to the executable directory).

Usage: python3 scripts/strip-personal-paths.py <binary> [<binary> ...]
"""
import sys

NEUTRAL = b"quinki-buildenv"
TARGETS = [b"andreamaddalena"]

def neutralize(path):
    with open(path, "rb") as f:
        data = f.read()
    total = 0
    for t in TARGETS:
        assert len(t) == len(NEUTRAL), "placeholder must be same length"
        n = data.count(t)
        if n:
            data = data.replace(t, NEUTRAL)
            total += n
    if total:
        with open(path, "wb") as f:
            f.write(data)
        # macOS arm64: la firma ad-hoc e' stata invalidata dal patch -> la riapplichiamo.
        if sys.platform == "darwin":
            import subprocess
            subprocess.run(["codesign", "--force", "--sign", "-", path], capture_output=True)
    return total

rc = 0
for p in sys.argv[1:]:
    try:
        n = neutralize(p)
        print(f"[strip-paths] {p}: {n} replaced" + ("" if n else " (already clean)"))
    except Exception as e:
        print(f"[strip-paths] {p}: ERROR {e}")
        rc = 1
sys.exit(rc)
