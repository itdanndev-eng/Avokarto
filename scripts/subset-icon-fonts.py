"""Cut the Font Awesome fonts down to the glyphs the site uses.

    npm run icons:fonts        (needs: python3 -m pip install fonttools brotli)

Reads the code points the icon stylesheet needs (one hex value per line on
stdin, printed by `node scripts/generate-icon-css.mjs --codepoints`), writes
public/assets/fonts/subset/<font>.woff2 for every Font Awesome font, and records
the covered code points in manifest.json. scripts/generate-icon-css.mjs only
points the stylesheet at these files while the manifest covers every icon in
use; otherwise it falls back to the full fonts, so a stale subset never shows
blank squares.
"""

import json
import subprocess
import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont, woff2

# Python's brotli rejects some of these WOFF2 streams that browsers and Node
# decode fine, so hand those to Node's decoder.
_python_decompress = woff2.brotli.decompress


class _Brotli:
    error = woff2.brotli.error
    MODE_FONT = woff2.brotli.MODE_FONT

    @staticmethod
    def decompress(data):
        try:
            return _python_decompress(data)
        except woff2.brotli.error:
            script = "process.stdout.write(require('zlib').brotliDecompressSync(require('fs').readFileSync(0)))"
            return subprocess.run(["node", "-e", script], input=data, capture_output=True, check=True).stdout

    compress = staticmethod(woff2.brotli.compress)


woff2.brotli = _Brotli

root = Path(__file__).resolve().parent.parent
source_dir = root / "public/assets/fonts"
out_dir = source_dir / "subset"
out_dir.mkdir(exist_ok=True)

codepoints = sorted({int(line.strip(), 16) for line in sys.stdin if line.strip()})
if not codepoints:
    sys.exit("No code points on stdin; refusing to write empty fonts.")

options = subset.Options()
options.flavor = "woff2"
options.layout_features = []  # icon names as ligatures are not used by the CSS
options.name_IDs = ["*"]  # keep the license and copyright records
options.notdef_outline = True
options.drop_tables += ["DSIG"]

fonts = {}
for font_path in sorted(source_dir.glob("fa-*.woff2")):
    font = TTFont(font_path)
    available = set(font.getBestCmap())
    wanted = [cp for cp in codepoints if cp in available]
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=wanted)
    subsetter.subset(font)
    target = out_dir / font_path.name
    font.flavor = "woff2"
    font.save(target)
    fonts[font_path.name] = {"glyphs": len(wanted), "bytes": target.stat().st_size}
    print(f"{font_path.name}: {font_path.stat().st_size:,} -> {target.stat().st_size:,} bytes ({len(wanted)} icons)")

manifest = {"codepoints": [f"{cp:x}" for cp in codepoints], "fonts": fonts}
(out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
