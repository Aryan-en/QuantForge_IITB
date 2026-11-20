#!/usr/bin/env bash
# Builds docs/writeup/FORGE-writeup.pdf (pandoc -> HTML -> headless Chrome) and enforces the 1-3 page limit.
set -euo pipefail
cd "$(dirname "$0")/../docs/writeup"
pandoc WRITEUP.md -s --css style.css --embed-resources --metadata pagetitle="FORGE write-up" -o /tmp/forge-writeup.html
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
"$CHROME" --headless=new --disable-gpu --no-pdf-header-footer --print-to-pdf=FORGE-writeup.pdf file:///tmp/forge-writeup.html 2>/dev/null
pages=$(pdfinfo FORGE-writeup.pdf | awk '/^Pages:/{print $2}')
echo "FORGE-writeup.pdf: $pages page(s)"
[ "$pages" -le 3 ] || { echo "ERROR: write-up exceeds 3 pages"; exit 1; }
left=$(grep -c "⟦FILL" WRITEUP.md || true)
if [ "$left" -gt 0 ]; then echo "WARNING: $left unfilled ⟦FILL⟧ placeholder(s) remain — do NOT submit yet"; fi
