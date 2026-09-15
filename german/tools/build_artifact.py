#!/usr/bin/env python3
"""Bundle the app into one self-contained HTML file.

The app normally runs as separate files served over HTTP. Some places to put it
— a published Artifact, an email attachment, a USB stick — need a single file
with no network access at all, so this inlines everything:

    styles.css             -> <style>
    src/*.js               -> one inline module (imports/exports stripped)
    data/vocabulary.json   -> <script type="application/json">
    data/grammar.json      -> <script type="application/json">
    assets/master-fuka.jpg -> a data: URI

Output is written to dist/master-fuka-german.html and is byte-for-byte
reproducible from the sources — edit the sources, never the bundle.

Usage:  python3 german/tools/build_artifact.py
"""

from __future__ import annotations

import base64
import mimetypes
import re
import sys
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
OUT = APP / "dist" / "master-fuka-german.html"

# Concatenation order matters: a module may only use names declared above it.
MODULE_ORDER = [
    "data.js", "grammar.js", "audio.js", "srs.js", "db.js", "progress.js", "search.js",
    "exercises.js", "lessons.js", "coach.js", "fuka.js", "ui.js", "runner.js",
    "views.js", "learnViews.js", "app.js",
]

# Each data file becomes a <script type="application/json"> block that the
# corresponding module reads instead of fetching.
DATA_FILES = [
    ("vocabulary", "vocabulary.json"),
    ("grammar", "grammar.json"),
]

FONTS = "https://fonts.googleapis.com/css2?family=Nunito:wght@600;700;800&family=Source+Sans+3:wght@400;600&display=swap"

IMPORT_RE = re.compile(r"^import\s+[\s\S]*?from\s+'[^']+';\s*$", re.MULTILINE)
EXPORT_BLOCK_RE = re.compile(r"^export\s*\{[^}]*\};\s*$", re.MULTILINE)
EXPORT_KEYWORD_RE = re.compile(r"^export\s+(?=const|let|var|function|async|class)", re.MULTILINE)


ALIAS_RE = re.compile(r"^import\s*\{[^}]*\bas\b[^}]*\}\s*from", re.MULTILINE | re.DOTALL)


def strip_module_syntax(source: str, name: str) -> str:
    """Turn an ES module into plain top-level code for one shared scope.

    Everything ends up in one scope, so an aliased import ("advance as
    advanceRun") would leave the alias undefined once the import line is
    stripped. Rename at the source instead; this guard makes that failure loud
    at build time rather than at runtime in the bundle only.
    """
    if ALIAS_RE.search(source):
        raise SystemExit(
            f"{name}: aliased import ('x as y') cannot be flattened into one scope — "
            "rename the export at its source instead")
    source = IMPORT_RE.sub("", source)
    source = EXPORT_BLOCK_RE.sub("", source)
    source = EXPORT_KEYWORD_RE.sub("", source)
    for leftover in ("import ", "export "):
        for line in source.splitlines():
            if line.startswith(leftover):
                raise SystemExit(f"{name}: could not strip module syntax from: {line!r}")
    return f"// ---- src/{name} " + "-" * max(0, 60 - len(name)) + f"\n{source.strip()}\n"


def data_uri(path: Path) -> str:
    mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    return f"data:{mime};base64,{base64.b64encode(path.read_bytes()).decode('ascii')}"


def main() -> int:
    css = (APP / "styles.css").read_text(encoding="utf-8")
    avatar = data_uri(APP / "assets" / "master-fuka.jpg")

    payloads = {}
    for name, filename in DATA_FILES:
        text = (APP / "data" / filename).read_text(encoding="utf-8")
        if "</" in text:
            raise SystemExit(f"{filename} contains '</' and cannot be embedded verbatim")
        payloads[name] = text

    script = "\n".join(
        strip_module_syntax((APP / "src" / name).read_text(encoding="utf-8"), name)
        for name in MODULE_ORDER
    )

    # The bundle has no server to fetch from: read the embedded JSON instead.
    fetch_block = re.compile(
        r"const response = await fetch\(new URL\('\.\./data/(\w+)\.json', import\.meta\.url\)\);\n"
        r"\s*if \(!response\.ok\) throw new Error\(`[^`]*`\);\n"
        r"\s*(\w+) = await response\.json\(\);")

    def inline_data(match: re.Match) -> str:
        name, variable = match.group(1), match.group(2)
        if name not in payloads:
            raise SystemExit(f"module fetches data/{name}.json, which this script does not embed")
        return f"{variable} = JSON.parse(document.getElementById('{name}-data').textContent);"

    script, replaced = fetch_block.subn(inline_data, script)
    if replaced != len(DATA_FILES):
        raise SystemExit(
            f"expected {len(DATA_FILES)} data fetches to inline, found {replaced} — update this script")
    script = script.replace("./assets/master-fuka.jpg", avatar)

    body_html = (APP / "index.html").read_text(encoding="utf-8")
    body_html = body_html.split("<body class=\"is-loading\">", 1)[1].split("</body>", 1)[0]
    body_html = body_html.replace("./assets/master-fuka.jpg", avatar)
    body_html = re.sub(r'\s*<script type="module"[^>]*></script>', "", body_html)

    data_blocks = "\n".join(
        f'<script type="application/json" id="{name}-data">{payloads[name]}</script>'
        for name, _ in DATA_FILES)

    page = f"""<title>Master Fuka German</title>
<style>
@import url("{FONTS}");
{css}
/* The Artifact host supplies the document shell, so the class the app removes
   once the vocabulary has loaded lives on a wrapper instead of <body>. */
body {{ margin: 0; }}
</style>

<div class="app is-loading" id="app">
{body_html.strip()}
</div>

{data_blocks}
<script type="module">
{script}
</script>
"""
    # The app toggles `is-loading` on document.body; in the bundle that class
    # sits on the wrapper, so retarget the two places that touch it.
    page = page.replace("document.body.classList.remove('is-loading')",
                        "document.getElementById('app').classList.remove('is-loading')")
    page = page.replace(".is-loading .main {", ".app.is-loading .main {")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(page, encoding="utf-8")
    print(f"{OUT}  ({OUT.stat().st_size / 1_048_576:.2f} MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
