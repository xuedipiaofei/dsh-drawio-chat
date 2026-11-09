#!/usr/bin/env bash
# Dev helper: render one .drawio file to a PNG with draw.io's viewer.
#
# Usage: scripts/preview-drawio.sh <file.drawio> [out.png] [WxH]
#   CHROME=/path/to/chrome to override the browser.
# Requires network once (viewer-static.min.js) and headless Chrome.
set -euo pipefail

SRC="${1:?usage: scripts/preview-drawio.sh <file.drawio> [out.png] [WxH]}"
OUT="${2:-/tmp/drawio-preview.png}"
SIZE="${3:-1400,1000}"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"

if [ ! -f "$SRC" ]; then echo "no such file: $SRC" >&2; exit 1; fi
if [ ! -x "$CHROME" ]; then echo "chrome not found: $CHROME (set CHROME=...)" >&2; exit 1; fi
mkdir -p "$(dirname "$OUT")"
OUT="$(cd "$(dirname "$OUT")" && pwd)/$(basename "$OUT")"
SRC="$(cd "$(dirname "$SRC")" && pwd)/$(basename "$SRC")"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

python3 - "$SRC" "$TMP/viewer.html" <<'PY'
import json, pathlib, sys
xml = pathlib.Path(sys.argv[1]).read_text()
literal = json.dumps(xml, ensure_ascii=False).replace('<', '\\u003c')
html = f'''<!doctype html><html><head><meta charset="utf-8"><style>
html,body{{margin:0;height:100%;background:#ffffff}}
.mxgraph{{height:100%;max-width:100%}}
</style></head><body>
<div class="mxgraph" id="drawio-graph"></div>
<script>
window.mxBasePath='https://viewer.diagrams.net/';
var config={{xml:{literal},highlight:'#7aaaff',nav:true,resize:true,toolbar:''}};
document.getElementById('drawio-graph').setAttribute('data-mxgraph', JSON.stringify(config));
</script>
<script src="https://viewer.diagrams.net/js/viewer-static.min.js"></script>
</body></html>'''
pathlib.Path(sys.argv[2]).write_text(html)
PY

"$CHROME" --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
  --user-data-dir="$TMP/chrome-profile" --force-device-scale-factor=1 \
  --window-size="$SIZE" --virtual-time-budget=15000 \
  --screenshot="$OUT" "file://$TMP/viewer.html" 2>/dev/null

echo "preview: $OUT"
