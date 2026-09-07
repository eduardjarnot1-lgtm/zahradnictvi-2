#!/usr/bin/env python3
"""Bundle the app into one self-contained HTML file.

The app normally runs as separate files served over HTTP. Some places to put it
— a published Artifact, an email attachment, a USB stick — need a single file
with no network access at all, so this inlines everything:

    styles.css            -> <style>
    src/*.js              -> one inline module (imports/exports stripped)
    data/vocabulary.json  -> <script type="application/json">
    assets/master-fuka.jpg-> a data: URI

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
    "data.js", "progress.js", "fuka.js", "search.js",
    "practice.js", "ui.js", "views.js", "app.js",
]

FONTS = "https://fonts.googleapis.com/css2?family=Nunito:wght@600;700;800&family=Source+Sans+3:wght@400;600&display=swap"

IMPORT_RE = re.compile(r"^import\s+[\s\S]*?from\s+'[^']+';\s*$", re.MULTILINE)
EXPORT_BLOCK_RE = re.compile(r"^export\s*\{[^}]*\};\s*$", re.MULTILINE)
EXPORT_KEYWORD_RE = re.compile(r"^export\s+(?=const|let|var|function|async|class)", re.MULTILINE)


def strip_module_syntax(source: str, name: str) -> str:
    """Turn an ES module into plain top-level code for one shared scope."""
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
    vocabulary = (APP / "data" / "vocabulary.json").read_text(encoding="utf-8")
    avatar = data_uri(APP / "assets" / "master-fuka.jpg")

    if "</" in vocabulary:
        raise SystemExit("vocabulary.json contains '</' and cannot be embedded verbatim")

    script = "\n".join(
        strip_module_syntax((APP / "src" / name).read_text(encoding="utf-8"), name)
        for name in MODULE_ORDER
    )

    # The bundle has no server to fetch from: read the embedded JSON instead.
    fetch_call = "const response = await fetch(new URL('../data/vocabulary.json', import.meta.url));"
    if fetch_call not in script:
        raise SystemExit("data.js no longer contains the expected fetch call — update this script")
    script = script.replace(
        fetch_call
        + "\n  if (!response.ok) throw new Error(`Could not load vocabulary (${response.status})`);"
        + "\n  db = await response.json();",
        "db = JSON.parse(document.getElementById('vocabulary-data').textContent);",
    )
    script = script.replace("./assets/master-fuka.jpg", avatar)

    body_html = (APP / "index.html").read_text(encoding="utf-8")
    body_html = body_html.split("<body class=\"is-loading\">", 1)[1].split("</body>", 1)[0]
    body_html = body_html.replace("./assets/master-fuka.jpg", avatar)
    body_html = re.sub(r'\s*<script type="module"[^>]*></script>', "", body_html)

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

<script type="application/json" id="vocabulary-data">{vocabulary}</script>
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
