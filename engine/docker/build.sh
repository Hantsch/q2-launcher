#!/usr/bin/env bash
# Runs inside the engine container; the host (scripts/engine/build.mjs) validates patch order. (story 281)
set -Eeuo pipefail

SRC=/engine-build/src
BUILD=/engine-build/build
OUT=/engine-build/out

if [ "${1:-}" = "--objdump" ]; then
  wasm-objdump -x "${2:-$OUT/q2pro.wasm}"
  exit 0
fi

OPT="${1:?usage: build.sh O0|O1|O2 [--check-config]}"
CHECK="${2:-}"
: "${REPO:?}" "${COMMIT:?}"
OPT_NUM="${OPT#O}"

git config --global --add safe.directory '*'
mkdir -p "$SRC"
cd "$SRC"
[ -d .git ] || { git init -q; git remote add origin "$REPO"; }
git fetch -q --depth 1 origin "$COMMIT"
git checkout -q -f "$COMMIT"
git reset -q --hard "$COMMIT"
git clean -fdxq

# The source embeds __DATE__; pin it to the commit so the same input gives the same wasm.
SOURCE_DATE_EPOCH="$(git show -s --format=%ct "$COMMIT")"
export SOURCE_DATE_EPOCH

# The host validated the order; applying any other would hide a host/container disagreement.
if [ -z "${PATCH_ORDER-}" ] && [ -n "$(ls -A /engine-patches 2>/dev/null)" ]; then
  echo "PATCH_ORDER is missing but /engine-patches is not empty" >&2
  exit 1
fi
while IFS= read -r p; do
  [ -n "$p" ] || continue
  echo "applying $p"
  git apply --whitespace=nowarn "/engine-patches/$p"
done <<< "${PATCH_ORDER-}"

rm -rf "$BUILD"
# buildtype=plain: meson adds no -O/-g beyond -Doptimization. All options below exist in meson_options.txt.
# b_staticpic=false: meson otherwise compiles the static subprojects (zlib-ng, libpng) with -fPIC,
# and at -O1/-O2 that turns zlib-ng's functable stubs into wasm that wasm-emscripten-finalize rejects.
meson setup "$BUILD" --cross-file /engine/cross/emscripten.ini \
  -Dbuildtype=plain -Doptimization="$OPT_NUM" -Db_staticpic=false \
  -Dlibcurl=disabled -Dopenal=disabled -Dsdl2=disabled -Dx11=disabled -Dwayland=disabled \
  -Davcodec=disabled -Dlibjpeg=disabled -Dsystem-console=false -Dclient-gtv=false \
  -Dclient-ui=false -Dmvd-server=false -Dsave-games=false -Dtests=false \
  -Dzlib=enabled -Dlibpng=enabled -Dsoftware-sound=enabled

if [ "$CHECK" = "--check-config" ]; then
  echo "@@BUILDOPTIONS@@"
  meson introspect --buildoptions "$BUILD"
  echo
  echo "@@TARGETS@@"
  meson introspect --targets "$BUILD"
  echo
  exit 0
fi

# Only the engine is built: subproject test programs (libpng's pngtest) are not shipped and
# fail emscripten's finalize step.
ninja -C "$BUILD" q2pro.js
mkdir -p "$OUT"
for f in q2pro.js q2pro.wasm; do
  found="$(find "$BUILD" -name "$f" -print -quit)"
  [ -n "$found" ] || { echo "missing build output: $f" >&2; exit 1; }
  cp "$found" "$OUT/$f"
done
