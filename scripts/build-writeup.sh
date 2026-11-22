#!/usr/bin/env bash
# Builds docs/writeup/QuantForge-writeup.pdf (pandoc -> HTML -> headless Chrome) and enforces the 1-3 page limit.
set -euo pipefail
cd "$(dirname "$0")/../docs/writeup"
pandoc WRITEUP.md -s --css style.css --embed-resources --metadata pagetitle="QuantForge write-up" -o /tmp/forge-writeup.html
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
"$CHROME" --headless=new --disable-gpu --no-pdf-header-footer --print-to-pdf=QuantForge-writeup.pdf file:///tmp/forge-writeup.html 2>/dev/null
pages=$(pdfinfo QuantForge-writeup.pdf | awk '/^Pages:/{print $2}')
echo "QuantForge-writeup.pdf: $pages page(s)"
[ "$pages" -le 3 ] || { echo "ERROR: write-up exceeds 3 pages"; exit 1; }
left=$(grep -c "⟦FILL" WRITEUP.md || true)
if [ "$left" -gt 0 ]; then echo "WARNING: $left unfilled ⟦FILL⟧ placeholder(s) remain — do NOT submit yet"; fi
