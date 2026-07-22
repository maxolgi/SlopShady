#!/usr/bin/env bash
# Build the three WASM crates from the WebSRT submodule and copy their pkg
# output into static/wasm/. Run this after `git submodule update --init` and
# after any change to vendored WebSRT sources.
#
# Output is byte-stable for a given rustc/wasm-pack/wasm-opt version, so the
# committed artifacts in static/wasm/ are reproducible from this script.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SUB="$REPO_ROOT/vendor/WebSRT"
OUT="$REPO_ROOT/static/wasm"

if [ ! -e "$SUB/.git" ]; then
    echo "ERROR: vendor/WebSRT submodule not initialized." >&2
    echo "       Run: git submodule update --init --recursive" >&2
    exit 1
fi

command -v wasm-pack >/dev/null 2>&1 || {
    echo "ERROR: wasm-pack not installed. Run: cargo install wasm-pack" >&2
    exit 1
}

rustup target list --installed | grep -q '^wasm32-unknown-unknown' || {
    echo "ERROR: wasm32 target missing. Run: rustup target add wasm32-unknown-unknown" >&2
    exit 1
}

build_crate() {
    local name="$1"
    echo "==> building $name"
    ( cd "$SUB/crates/$name" && wasm-pack build --target web --release )
    rm -rf "$OUT/$name"
    mkdir -p "$OUT/$name"
    cp "$SUB/crates/$name/pkg/"* "$OUT/$name/"
    rm -f "$OUT/$name/.gitignore"
}

build_crate srt-wasm
build_crate ts-muxer-wasm
build_crate mpeg2ts-wasm

echo "==> done. Artifacts in static/wasm/"
