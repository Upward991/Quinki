#!/bin/bash
# ============================================================================
# build-logo.sh — Genera TUTTE le icone Quinki dal font pixel (la "q" e la "E"
# del wordmark del terminale, stesso bitmap: cli/tui/app.ts QPIX).
#
# Varianti:
#   main-violet    q scuro su fondo VIOLA   (DEFAULT della Main)
#   main-dark      q viola su fondo scuro
#   main-current   icona ORIGINALE (mascotte) — mai persa, sempre recuperabile
#   expert-orange  E scura su fondo ARANCIONE (DEFAULT dell'Expert)
#   expert-dark    E arancione su fondo scuro
#   expert-current icona ORIGINALE (robot) — mai persa
#
# Produce:
#   src-tauri/resources/icons/app/<variant>.png (1024) + .icns + tray png
#   src-tauri/icons/*        (default del bundle: violet / expert orange)
#   src/components/settings/appIconAssets.ts  (anteprime 64px base64)
#
# Idempotente: le icone ORIGINALI vengono salvate come *-current SOLO la prima
# volta (se già presenti, non vengono toccate).
# ============================================================================
set -e
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

python3 - <<'PYEOF'
import os, io, base64, subprocess, tempfile, shutil
from PIL import Image, ImageDraw

ROOT  = os.getcwd()
ICONS = os.path.join(ROOT, "src-tauri", "icons")
RES   = os.path.join(ROOT, "src-tauri", "resources", "icons", "app")
os.makedirs(RES, exist_ok=True)

# --- stesso bitmap del wordmark del terminale (cli/tui/app.ts QPIX) ---
Q = ["01110","10001","10001","10001","10001","01110","00010","00011"]
E = ["01110","10000","10000","11110","10000","10000","01110"]

DARK   = (8, 8, 11, 255)      # #08080b
VIOLET = (157, 139, 217, 255) # #9d8bd9  (brand Quinki)
ORANGE = (217, 160, 102, 255) # #d9a066  (accent App Expert)

VARIANTS = {
    "main-violet":   dict(glyph=Q, tile=VIOLET, ink=DARK),
    "main-dark":     dict(glyph=Q, tile=DARK,   ink=VIOLET),
    "expert-orange": dict(glyph=E, tile=ORANGE, ink=DARK),
    "expert-dark":   dict(glyph=E, tile=DARK,   ink=ORANGE),
}

def bounds(g):
    rows = [r for r, row in enumerate(g) if "1" in row]
    cols = [c for row in g for c, ch in enumerate(row) if ch == "1"]
    return min(rows), max(rows), min(cols), max(cols)

def render(v, size, style="app"):
    spec = VARIANTS[v]
    # style: "app" = griglia icona macOS (contenuto ~80%, padding trasparente);
    #        "tray" = full-bleed arrotondato; "pwa" = quadrato pieno (mascherano iOS/Android)
    if style == "app":
        inner = int(size * 0.80)
    else:
        inner = size
    # Scala del glifo per stile: le icone MOBILE (pwa) hanno più padding attorno
    # alle lettere (le maschere Android/iOS tagliano i bordi -> mai far sbordare).
    off = (size - inner) // 2
    S = 4
    bg = Image.new("RGBA", (size * S, size * S), (0, 0, 0, 0))
    if style == "pwa":
        ImageDraw.Draw(bg).rectangle([0, 0, size * S - 1, size * S - 1], fill=spec["tile"])
    else:
        ImageDraw.Draw(bg).rounded_rectangle([off * S, off * S, (off + inner) * S - 1, (off + inner) * S - 1],
                                             radius=int(inner * 0.22 * S), fill=spec["tile"])
    img = bg.resize((size, size), Image.LANCZOS)
    g = spec["glyph"]
    rows = len(g)
    b = bounds(g)
    if style == "pwa":
        # MOBILE: stessa ALTEZZA per la q (8 righe) e la E (7 righe) -> stesso padding!
        cell = max(1, round(inner * 0.48 / rows))
    else:
        cell = max(1, round(inner * 0.78 / 8))  # mac/tray: base 8 righe (invariata)
    if cell * rows > inner - 4:
        cell = max(1, cell - 1)
    w = cell * (b[3] - b[2] + 1)
    h = cell * (b[1] - b[0] + 1)
    ax = off + (inner - w) // 2
    ay = off + (inner - h) // 2
    d = ImageDraw.Draw(img)
    for rr in range(b[0], b[1] + 1):
        for cc in range(b[2], b[3] + 1):
            if g[rr][cc] == "1":
                x = ax + (cc - b[2]) * cell
                y = ay + (rr - b[0]) * cell
                d.rectangle([x, y, x + cell - 1, y + cell - 1], fill=spec["ink"])
    return img

def make_icns(v, out):
    with tempfile.TemporaryDirectory() as td:
        st = os.path.join(td, "x.iconset")
        os.makedirs(st)
        sizes = {"icon_16x16.png":16, "icon_16x16@2x.png":32, "icon_32x32.png":32,
                 "icon_32x32@2x.png":64, "icon_128x128.png":128, "icon_128x128@2x.png":256,
                 "icon_256x256.png":256, "icon_256x256@2x.png":512,
                 "icon_512x512.png":512, "icon_512x512@2x.png":1024}
        for name, s in sizes.items():
            render(v, s).save(os.path.join(st, name))
        subprocess.run(["iconutil", "-c", "icns", st, "-o", out], check=True)

def to1024(src, out):
    im = Image.open(src).convert("RGBA")
    if im.size != (1024, 1024):
        im = im.resize((1024, 1024), Image.LANCZOS)
    im.save(out)

# 1) ORIGINALI -> *-current (SOLO la prima volta: mai sovrascrivere la copia)
if not os.path.exists(os.path.join(RES, "main-current.icns")):
    shutil.copy2(os.path.join(ICONS, "icon.icns"), os.path.join(RES, "main-current.icns"))
    to1024(os.path.join(ICONS, "icon.png"), os.path.join(RES, "main-current.png"))
    print("salvate le icone ORIGINALI (main-current)")
if not os.path.exists(os.path.join(RES, "expert-current.icns")):
    shutil.copy2(os.path.join(ICONS, "expert-icon.icns"), os.path.join(RES, "expert-current.icns"))
    to1024(os.path.join(ICONS, "expert-icon.png"), os.path.join(RES, "expert-current.png"))
    print("salvate le icone ORIGINALI (expert-current)")

# 2) varianti pixel: png 1024 + icns + tray 32
for v in VARIANTS:
    render(v, 1024).save(os.path.join(RES, v + ".png"))
    make_icns(v, os.path.join(RES, v + ".icns"))
    render(v, 32, "tray").save(os.path.join(RES, v + "-tray.png"))
    print("generata:", v)

# 3) default del bundle: Main viola, Expert arancio
shutil.copy2(os.path.join(RES, "main-violet.icns"), os.path.join(ICONS, "icon.icns"))
render("main-violet", 1024).save(os.path.join(ICONS, "icon.png"))
render("main-violet", 32).save(os.path.join(ICONS, "32x32.png"))
render("main-violet", 128).save(os.path.join(ICONS, "128x128.png"))
render("main-violet", 256).save(os.path.join(ICONS, "128x128@2x.png"))
render("main-violet", 512).save(os.path.join(ICONS, "icon.ico"),
                                format="ICO", sizes=[(16,16),(32,32),(48,48),(64,64),(128,128),(256,256)])
render("main-violet", 32).save(os.path.join(ICONS, "tray-icon.png"))
shutil.copy2(os.path.join(RES, "expert-orange.icns"), os.path.join(ICONS, "expert-icon.icns"))
shutil.copy2(os.path.join(RES, "expert-orange.icns"), os.path.join(ROOT, "src-tauri", "resources", "expert-icon.icns"))
render("expert-orange", 1024).save(os.path.join(ICONS, "expert-icon.png"))
render("expert-orange", 64).save(os.path.join(ICONS, "expert-tray-icon.png"))
print("aggiornati i default del bundle (Main violet, Expert orange)")

# 3b) ICONE PWA/TELEFONO (quadrato pieno: iOS e Android mascherano da soli):
#     Main = q violet-bg, Expert = E orange-bg
PUB = os.path.join(ROOT, "public")
os.makedirs(os.path.join(PUB, "icons"), exist_ok=True)
render("main-violet", 192, "pwa").save(os.path.join(PUB, "icons", "icon-192.png"))
render("main-violet", 512, "pwa").save(os.path.join(PUB, "icons", "icon-512.png"))
render("main-violet", 180, "pwa").save(os.path.join(PUB, "apple-touch-icon.png"))
render("expert-orange", 192, "pwa").save(os.path.join(PUB, "icons", "expert-icon-192.png"))
render("expert-orange", 512, "pwa").save(os.path.join(PUB, "icons", "expert-icon-512.png"))
render("expert-orange", 180, "pwa").save(os.path.join(PUB, "icons", "expert-apple-touch.png"))
print("icone PWA aggiornate (telefono): q viola (Main) + E arancio (Expert)")

# 3c) ICONE ANDROID (APK): per flavor — quinki = q su viola, expert = E su arancio.
#     - ic_launcher.png      = quadrato pieno (legacy, API<26)
#     - ic_launcher_round    = cerchio pieno
#     - ic_launcher_foreground = glifo trasparente nella SAFE ZONE (adaptive icon)
#     - colors.xml (ic_launcher_background) = colore del tile
AND = os.path.join(ROOT, "android", "app", "src")
LAUNCHER = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
FG = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}
FLAVOR_VARIANT = {"quinki": "main-violet", "expert": "expert-orange"}

def android_glyph(v, size, scale):
    # scale = frazione di ALTEZZA del glifo (per righe reali: q 8, E 7) -> padding UGUALE
    spec = VARIANTS[v]
    g = spec["glyph"]
    b = bounds(g)
    rows = len(g)
    cell = max(1, round(size * scale / rows))
    w = cell * (b[3] - b[2] + 1)
    h = cell * (b[1] - b[0] + 1)
    ax = (size - w) // 2
    ay = (size - h) // 2
    out = []
    for rr in range(b[0], b[1] + 1):
        for cc in range(b[2], b[3] + 1):
            if g[rr][cc] == "1":
                out.append((ax + (cc - b[2]) * cell, ay + (rr - b[0]) * cell, cell))
    return out, spec["ink"]

def android_icon(v, size, kind):
    spec = VARIANTS[v]
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if kind == "foreground":
        rects, ink = android_glyph(v, size, 0.50)
        for (x, y, c) in rects:
            d.rectangle([x, y, x + c - 1, y + c - 1], fill=ink)
    else:
        if kind == "round":
            d.ellipse([0, 0, size - 1, size - 1], fill=spec["tile"])
            rects, ink = android_glyph(v, size, 0.46)
        else:
            d.rectangle([0, 0, size - 1, size - 1], fill=spec["tile"])
            rects, ink = android_glyph(v, size, 0.56)
        for (x, y, c) in rects:
            d.rectangle([x, y, x + c - 1, y + c - 1], fill=ink)
    return img

def android_colors_hex(v):
    t = VARIANTS[v]["tile"]
    return "#%02X%02X%02X" % (t[0], t[1], t[2])

NOTIF = {"mdpi": 24, "hdpi": 36, "xhdpi": 48, "xxhdpi": 72, "xxxhdpi": 96}

def notif_icon(v, size):
    # small icon notifiche: glifo BIANCO su trasparente (Android lo tinge da solo)
    g = VARIANTS[v]["glyph"]
    b = bounds(g)
    rows = len(g)
    cell = max(1, round(size * 0.72 / rows))
    w = cell * (b[3] - b[2] + 1); h = cell * (b[1] - b[0] + 1)
    ax = (size - w) // 2; ay = (size - h) // 2
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    for rr in range(b[0], b[1] + 1):
        for cc in range(b[2], b[3] + 1):
            if g[rr][cc] == "1":
                d.rectangle([ax + (cc - b[2]) * cell, ay + (rr - b[0]) * cell,
                             ax + (cc - b[2]) * cell + cell - 1, ay + (rr - b[0]) * cell + cell - 1],
                            fill=(255, 255, 255, 255))
    return img

for flavor, variant in FLAVOR_VARIANT.items():
    base = os.path.join(AND, flavor, "res")
    # ic_stat_quinki: il flavor quinki usa la res di MAIN (condivisa), expert ha la sua
    notif_base = os.path.join(AND, "expert", "res") if flavor == "expert" else os.path.join(AND, "main", "res")
    for dens, px in NOTIF.items():
        ddir = os.path.join(notif_base, "drawable-" + dens)
        os.makedirs(ddir, exist_ok=True)
        notif_icon(variant, px).save(os.path.join(ddir, "ic_stat_quinki.png"))
    print("icone notifica:", flavor, "->", notif_base)
    for dens, px in LAUNCHER.items():
        ddir = os.path.join(base, "mipmap-" + dens)
        os.makedirs(ddir, exist_ok=True)
        android_icon(variant, px, "launcher").save(os.path.join(ddir, "ic_launcher.png"))
        android_icon(variant, px, "round").save(os.path.join(ddir, "ic_launcher_round.png"))
    for dens, px in FG.items():
        ddir = os.path.join(base, "mipmap-" + dens)
        os.makedirs(ddir, exist_ok=True)
        android_icon(variant, px, "foreground").save(os.path.join(ddir, "ic_launcher_foreground.png"))
    vdir = os.path.join(base, "values")
    os.makedirs(vdir, exist_ok=True)
    open(os.path.join(vdir, "colors.xml"), "w").write(
        '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">%s</color>\n</resources>\n' % android_colors_hex(variant))
    print("icone Android:", flavor, "->", android_colors_hex(variant))

# 4) anteprime 64px per il selettore in Settings (data URL base64)
def dataurl(im):
    buf = io.BytesIO(); im.save(buf, "PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()

lines = []
for v in ["main-violet", "main-dark", "main-current", "expert-orange", "expert-dark", "expert-current"]:
    if v.endswith("-current"):
        src = os.path.join(RES, v + ".png")
        im = Image.open(src).convert("RGBA").resize((64, 64), Image.LANCZOS)
    else:
        im = render(v, 64)
    lines.append("  '%s': '%s'," % (v, dataurl(im)))

ts = ("// AUTO-GENERATO da scripts/build-logo.sh — non modificare a mano.\n"
      "export const APP_ICON_PREVIEWS: Record<string, string> = {\n" + "\n".join(lines) + "\n}\n")
open(os.path.join(ROOT, "src", "components", "settings", "appIconAssets.ts"), "w").write(ts)
print("anteprime scritte in src/components/settings/appIconAssets.ts")
PYEOF

echo "[build-logo] done."
