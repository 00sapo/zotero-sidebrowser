#!/bin/bash
# Build the plugin XPI.
#
# The output goes to dist/sidebrowser.xpi. The manifest ID and the file name must
# match, because Zotero reads the extension ID from the manifest.
#
# Test-only modules (src/selftest-*.mjs, src/testseed.mjs) are left out of the
# release build. Run `scripts/build.sh --with-tests` to keep them, which is what
# the headless checks need.
set -eu

cd "$(dirname "$0")/.."

NAME="sidebrowser"
OUT="dist/${NAME}.xpi"
WITH_TESTS="${1:-}"

EXCLUDES=(
  -x "*.git*"
  -x "dist/*"
  -x "scripts/*"
  -x "*.md"
  -x "*.xpi"
)

if [ "$WITH_TESTS" != "--with-tests" ]; then
  EXCLUDES+=(
    -x "src/selftest*.mjs"
    -x "src/testseed.mjs"
  )
fi

rm -rf dist
mkdir -p dist

zip -qr "$OUT" . "${EXCLUDES[@]}"

echo "Built $OUT"
unzip -l "$OUT" | tail -3
