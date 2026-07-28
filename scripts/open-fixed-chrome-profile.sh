#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

node "$SCRIPT_DIR/open-tampermonkey-profile.js" \
  --cdp-port 9226 \
  --url "http://127.0.0.1:4173/tampermonkey-worker-probe.html" \
  "$@"
