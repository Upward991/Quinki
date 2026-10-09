#!/usr/bin/env python3
"""Neutralize build-machine personal paths baked inside compiled binaries.

Some tools bake absolute build paths into compiled binaries (bun inlines CJS
__dirname; Swift and Go debug info embeds source paths). This replaces the
current user's username with a neutral SAME-LENGTH placeholder: pure in-place
byte replacement, so the binary layout never changes and runtime behavior is
unaffected. On macOS the ad-hoc signature is re-applied after patching.

Usage: python3 scripts/strip-personal-paths.py <binary> [<binary> ...]
"""
import getpass
import sys


def neutral_for(name):
    base = b"quinki-buildenv"
    return (base * 4)[: len(name)]


def neutralize(path):
    try:
        target = getpass.getuser().encode()
    except Exception:
        return 0
    if len(target) < 3:
        return 0
    neutral = neutral_for(target)
    with open(path, "rb") as f:
        data = f.read()
    n = data.count(target)
    if not n:
        return 0
    with open(path, "wb") as f:
        f.write(data.replace(target, neutral))
    # macOS: il patch invalida la firma ad-hoc -> la riapplichiamo subito.
    if sys.platform == "darwin":
        import subprocess
        subprocess.run(["codesign", "--force", "--sign", "-", path], capture_output=True)
    return n


rc = 0
for p in sys.argv[1:]:
    try:
        n = neutralize(p)
        print(f"[strip-paths] {p}: {n} replaced" + ("" if n else " (already clean)"))
    except Exception as e:
        print(f"[strip-paths] {p}: ERROR {e}")
        rc = 1
sys.exit(rc)
