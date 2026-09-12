#!/bin/sh
set -eu

PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ENGINE_DIR="$PROJECT_DIR/PentaZen"
BUILD_DIR=${TMPDIR:-/tmp}/pentazen-wasm-build
EMXX=${EMXX:-/Users/yuesun/Desktop/emsdk/upstream/emscripten/em++}

mkdir -p "$BUILD_DIR"

c++ -std=c++17 -O2 \
  "$ENGINE_DIR/src/pattern/main.cpp" \
  "$ENGINE_DIR/src/pattern/line.cpp" \
  -o "$BUILD_DIR/PatternGen"

(cd "$BUILD_DIR" && ./PatternGen)

"$EMXX" -std=c++17 -O3 -DNDEBUG -DPENTAZEN_WASM \
  -I"$ENGINE_DIR/src" -I"$ENGINE_DIR" -I"$BUILD_DIR" \
  "$PROJECT_DIR/wasm/pentazen_bindings.cpp" \
  "$ENGINE_DIR/src/board.cpp" \
  "$ENGINE_DIR/src/misc.cpp" \
  "$ENGINE_DIR/src/movegen.cpp" \
  "$ENGINE_DIR/src/search.cpp" \
  "$ENGINE_DIR/src/thread.cpp" \
  "$ENGINE_DIR/src/tt.cpp" \
  --bind \
  -sMODULARIZE=1 \
  -sEXPORT_ES6=1 \
  -sENVIRONMENT=web,worker,node \
  -sALLOW_MEMORY_GROWTH=1 \
  -sINITIAL_MEMORY=33554432 \
  -sMAXIMUM_MEMORY=268435456 \
  -sFILESYSTEM=0 \
  -sASSERTIONS=0 \
  -o "$PROJECT_DIR/wasm/pentazen.js"

echo "Built wasm/pentazen.js and wasm/pentazen.wasm"
