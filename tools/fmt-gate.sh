#!/bin/sh
# R9 (Ultron nit 5): run the size gate on a prettier-formatted copy, so a function can't pass max-lines-per-function
# only because its lines are dense. Formats a copy in a temp dir; the sources are never rewritten.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd); TMP=$(mktemp -d /tmp/osh-fmt-gate.XXXXXX)
trap 'rm -rf "$TMP"' EXIT
cd "$ROOT"
tar cf - --exclude=node_modules --exclude=dist apps packages tools eslint.config.js package.json | (cd "$TMP" && tar xf -)
ln -s "$ROOT/node_modules" "$TMP/node_modules"
"$ROOT/node_modules/.bin/prettier" --config tools/gate/prettierrc.json --log-level warn --write "$TMP/apps/**/src/**/*.js" "$TMP/packages/**/src/**/*.js"
cd "$TMP" && "$ROOT/node_modules/.bin/eslint" --no-config-lookup --config tools/gate/size-gate.eslint.mjs apps packages
echo "fmt-gate: size gate passes on the prettier-formatted copy"
