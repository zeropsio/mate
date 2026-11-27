#!/usr/bin/env bash
# The linux-x64 pty.node the server bundle carries (apps/server/scripts/bundleNodePty.ts):
#   key          prints the cache key: node-pty and node-addon-api as the pnpm lock resolved them,
#                the image digest, the runner arch and this file's hash (the build commands)
#   build <dir>  compiles <dir>/pty.node from exactly those inputs
# Main's Check cache job (ci.yml) is the key's only writer; the release restores the exact key or,
# on a miss, runs `build` itself, so a hit and a miss ship the same bytes.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Built against bullseye's glibc 2.31 so the addon loads on any newer image; it is N-API, so the
# Node major does not matter. Named by digest, which fixes the compiler and node-gyp: a tag moves.
# amd64 whatever the host: the bundle carries the addon as prebuilds/linux-x64.
image="node:22-bullseye@sha256:959fa6e5c12f4b08f58808f953c7a6a05f1f72629b57ef3a648b8809362fdad9"
platform="linux/amd64"

# node-pty as apps/server installed it, and node-addon-api as pnpm resolved it for that node-pty:
# npm on its own would take the newest version node-pty's range allows.
versions="$(node -e '
  const { createRequire } = require("node:module");
  const fromServer = createRequire(process.argv[1]);
  const ptyManifest = fromServer.resolve("node-pty/package.json");
  const addonApi = createRequire(ptyManifest)("node-addon-api/package.json");
  console.log(fromServer(ptyManifest).version, addonApi.version);
' "$root/apps/server/package.json")"
read -r node_pty_version node_addon_api_version <<<"$versions"

case "${1:-}" in
  key)
    arch="$(uname -m)"
    script_hash="$(sha256sum "${BASH_SOURCE[0]}")"
    echo "node-pty-prebuild-${node_pty_version}-node-addon-api-${node_addon_api_version}-image-${image##*@sha256:}-${arch}-script-${script_hash%% *}"
    ;;
  build)
    mkdir -p "${2:?build needs the output directory}"
    out="$(cd "$2" && pwd)"
    # Docker Hub refuses unauthenticated pulls from shared runners at times (rate limit, auth
    # outages: v0.15.23 failed twice), so the image comes from Google's Hub mirror first.
    pulled=""
    for candidate in "mirror.gcr.io/library/$image" "$image"; do
      for attempt in 1 2 3; do
        if docker pull -q --platform "$platform" "$candidate"; then pulled="$candidate"; break 2; fi
        sleep $((attempt * 10))
      done
    done
    [ -n "$pulled" ] || { echo "no $image image could be pulled" >&2; exit 1; }
    docker run --rm --platform "$platform" -v "$out:/out" \
      -e "NODE_PTY_VERSION=$node_pty_version" -e "NODE_ADDON_API_VERSION=$node_addon_api_version" \
      "$pulled" bash -ec '
        mkdir /w && cd /w && npm init -y >/dev/null
        npm pkg set "overrides.node-addon-api=${NODE_ADDON_API_VERSION}"
        npm install --no-audit --no-fund "node-pty@${NODE_PTY_VERSION}"
        built="$(cd node_modules/node-pty && node -p "require(\"node-addon-api/package.json\").version")"
        echo "node-pty ${NODE_PTY_VERSION} built against node-addon-api ${built}"
        [ "$built" = "$NODE_ADDON_API_VERSION" ] || { echo "npm did not install the pinned node-addon-api ${NODE_ADDON_API_VERSION}" >&2; exit 1; }
        cp node_modules/node-pty/build/Release/pty.node /out/pty.node
      '
    ;;
  *)
    echo "usage: $0 key | build <dir>" >&2
    exit 2
    ;;
esac
