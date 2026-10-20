#!/bin/sh
# Rebuild app/vendor/comfy-sdk.js: @comfyorg/sdk bundled for the browser (the studio has no build step of its own).
# Node built-ins the SDK imports for its file helpers are shimmed; the studio uses fromBytes and output URLs instead.
set -e
cd "$(dirname "$0")"
npm i --no-save @comfyorg/sdk@0.5.0 esbuild@0.25.10
VER=$(node -p "JSON.parse(require('fs').readFileSync('node_modules/@comfyorg/sdk/package.json')).version")
npx esbuild entry.js --bundle --format=esm --platform=browser --target=es2022 --minify \
  --alias:node:crypto=./shims/crypto.js --alias:node:fs=./shims/fs.js --alias:node:fs/promises=./shims/fs.js \
  --alias:node:path=./shims/path.js --alias:node:stream=./shims/stream.js --alias:node:stream/promises=./shims/stream.js \
  --banner:js="/* @comfyorg/sdk $VER (MIT, Comfy Org) bundled for the browser by tools/build-sdk. Includes zod, hash-wasm and eventsource-parser (MIT). */" \
  --outfile=../../app/vendor/comfy-sdk.js
