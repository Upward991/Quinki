#!/usr/bin/env bash
# scripts/rebuild-quinki.sh — Rebuild Quinki app with ALL fixes
# Run this if the design is lost or after any change to source files
set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="$PROJECT_DIR/.deep-cosmos-backup"
LOGBUILD_DIR="/tmp/logpanel-build"

echo "=== 1. Restore clean Deep Cosmos backup ==="
cp "$BACKUP_DIR/assets/index-DTnRbIdn.js" "$PROJECT_DIR/dist/assets/index-DTnRbIdn.js"
cp "$BACKUP_DIR/assets/index-Hpru02_U.css" "$PROJECT_DIR/dist/assets/index-Hpru02_U.css"
cp "$BACKUP_DIR/assets/react-CHdo91hT.svg" "$PROJECT_DIR/dist/assets/react-CHdo91hT.svg"
cp "$BACKUP_DIR/index.html" "$PROJECT_DIR/dist/index.html"

echo "=== 2. Compile LogPanel from TSX ==="
cd "$LOGBUILD_DIR"
cp /tmp/new-logpanel.tsx main.tsx
npx vite build 2>&1 | tail -3

echo "=== 3. Extract, map variables, inject LogPanel ==="
node << 'NODEEOF'
var fs = require("fs");
var compiled = fs.readFileSync("/tmp/logpanel-build/dist/logpanel-build.js", "utf8");
var funcStart = compiled.indexOf("function LogPanel(");
var depth = 0, inTmpl = false, inStr = false, strChar = "";
for (var i = funcStart; i < compiled.length; i++) {
  var c = compiled[i];
  if (!inTmpl && !inStr && (c === '"' || c === "'")) { inStr = true; strChar = c; continue; }
  if (inStr && c === strChar && compiled[i-1] !== "\\") { inStr = false; continue; }
  if (inStr) continue;
  if (c === "`") { inTmpl = !inTmpl; continue; }
  if (inTmpl) continue;
  if (c === "{") depth++;
  else if (c === "}") { depth--; if (depth === 0) { var funcEnd = i + 1; break; } }
}
var logFunc = compiled.substring(funcStart, funcEnd);
logFunc = logFunc.replace("function LogPanel(", "function rg(");
logFunc = logFunc.replace(/\bzjsx\(/g, "(0,z.jsx)(");
logFunc = logFunc.replace(/\bzjsxs\(/g, "(0,z.jsxs)(");
logFunc = logFunc.replace(/\buseState\(/g, "v.useState(");
logFunc = logFunc.replace(/\buseRef\(/g, "v.useRef(");
logFunc = logFunc.replace(/\buseEffect\(/g, "v.useEffect(");
var icons = {"__HOME__":"Et","__ACTIVITY__":"It","__SEARCH__":"Lt","__CHEVRONDOWN__":"sn","__CHEVRONUP__":"cn","__CHEVRONRIGHT__":"un","__CHECK__":"Bt","__COPY__":"Vt","__DOWNLOAD__":"Ut","__REFRESH__":"Gt","__TRASH__":"Ht"};
for (var p in icons) { logFunc = logFunc.replace(new RegExp('"'+p+'"',"g"), icons[p]); logFunc = logFunc.replace(new RegExp(p,"g"), icons[p]); }

var cosmos = fs.readFileSync("/Users/andreamaddalena/Projects/Quinki/dist/assets/index-DTnRbIdn.js", "utf8");
var rgStart = cosmos.indexOf("function rg(e){");
var rgEnd = cosmos.indexOf("function ig", rgStart);
var patched = cosmos.substring(0, rgStart) + logFunc + cosmos.substring(rgEnd);

// Fix nav arrows: Chat padding 4px→0px
patched = patched.replace(/padding:`4px`,color:`var\(--q-text-tertiary\)`,opacity:\.\d,lineHeight:`0`/g, function(m) { return m.replace('padding:`4px`','padding:`0px`'); });
// Fix nav arrows: Settings Yh padding 2px→0px
patched = patched.replace(/padding:`2px`,border:`none`,cursor:t\?`default`:`pointer`/g, function(m) { return m.replace('padding:`2px`','padding:`0px`'); });
// Fix nav arrows: Log padding "8px"→"0px" (double quotes from non-minified code)
patched = patched.replace(/padding: "8px",[\s\n]*color: searchMatches/g, function(m) { return m.replace('"8px"','"0px"'); });
// Fix search popup width: 280px→320px
patched = patched.replace("width:`280px`,padding:`10px`", "width:`320px`,padding:`10px`");
// Fix row 2 alignment: remove justifyContent center
patched = patched.replace("justifyContent:`center`,height:`24px`},children:[(0,z.jsx)(an,", "height:`24px`},children:[(0,z.jsx)(an,");
// Fix Calendar icon gap: 6px→10px
patched = patched.replace("(0,z.jsx)(an,{size:16,style:{color:`var(--q-text-tertiary)`,flexShrink:0}}),(0,z.jsx)(`div`,{style:{width:`6px`", "(0,z.jsx)(an,{size:16,style:{color:`var(--q-text-tertiary)`,flexShrink:0}}),(0,z.jsx)(`div`,{style:{width:`10px`");

try { new Function(patched); console.log("✅ JS valid"); }
catch(e) { console.log("❌ Error:", e.message.substring(0, 200)); process.exit(1); }
fs.writeFileSync("/Users/andreamaddalena/Projects/Quinki/dist/assets/index-DTnRbIdn.js", patched);
console.log("All patches applied! Size: " + patched.length);
NODEEOF

echo "=== 4. Disable beforeBuildCommand ==="
python3 -c "
import json
with open('$PROJECT_DIR/src-tauri/tauri.conf.json','r') as f: c=json.load(f)
c['build']['beforeBuildCommand'] = ''
with open('$PROJECT_DIR/src-tauri/tauri.conf.json','w') as f: json.dump(c,f,indent=2)
"

echo "=== 5. Build Tauri app ==="
cd "$PROJECT_DIR"
export PATH="$HOME/.cargo/bin:$PATH"
npx tauri build 2>&1 | tail -5

echo "=== 6. Install ==="
rm -rf /Applications/Quinki.app
cp -R src-tauri/target/release/bundle/macos/Quinki.app /Applications/Quinki.app

echo "=== 7. Start dev server ==="
pkill -f "5176" 2>/dev/null; sleep 1
cd "$PROJECT_DIR/dist" && nohup python3 -m http.server 5176 --bind 127.0.0.1 > /tmp/server5176.log 2>&1 &

echo "=== DONE ==="
echo "App: /Applications/Quinki.app"
echo "Dev: http://127.0.0.1:5176"
