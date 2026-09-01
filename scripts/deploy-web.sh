#!/usr/bin/env bash
#
# Build the hosted web client for one published channel and deploy it to the
# Zerops static service that serves that channel.
#
# The build runs here rather than on Zerops: zerops.yml declares no `build:`
# section, so `zcli service deploy` uploads an already built directory and no
# build container starts. `zcli service push` would instead upload
# `git archive HEAD` — ~200 MB for this monorepo, 126 MB of it vendored
# reference repositories under .repos/ — on every deploy, and then rebuild
# what CI has already built.
#
# .github/workflows/deploy-web.yml calls this script and adds nothing of its
# own, so a channel's configuration cannot drift between CI and a local run.
#
# Usage:  scripts/deploy-web.sh <nightly|latest>
#
# Environment:
#   ZEROPS_TOKEN   required — a Zerops integration token with access to the
#                  target service. Never echoed; `zcli login` consumes it.
#   APP_VERSION    required — the version the client reports about itself.
#                  Unset, vite falls back to apps/web/package.json, which is
#                  pinned at 0.1.0 and would label every deploy identically.
#   GIT_SHA        optional — defaults to the working tree's HEAD.
set -euo pipefail

channel="${1:-}"

case "$channel" in
  nightly)
    # z3-eval / z3web, the dogfood surface.
    service_id="hrbN8zrlSdi8U7r9bfkMBw"
    hosted_app_url="https://z3.krls.cz"
    smoke_origin="https://z3.krls.cz"
    ;;
  latest)
    # mate-prod / web, the published product.
    service_id="KT6aygSdQHiIvMTsEPRpjg"
    # Until mate.zerops.io has a DNS record and is attached to the service,
    # the Zerops subdomain IS the canonical URL. Both are under zerops.app /
    # zerops.io, which is what the z3 server's CORS allowlist in every user
    # container accepts — a domain outside those three suffixes would need
    # ZCP_Z3_ALLOWED_ORIGINS set on every container in the fleet.
    hosted_app_url="https://web-257.ny1.zerops.app"
    # Deliberately the Zerops subdomain even once the custom domain lands:
    # this check proves the deploy reached the service, and must not start
    # failing on a DNS or CDN problem sitting in front of it.
    smoke_origin="https://web-257.ny1.zerops.app"
    ;;
  *)
    echo "usage: scripts/deploy-web.sh <nightly|latest>" >&2
    exit 2
    ;;
esac

: "${ZEROPS_TOKEN:?ZEROPS_TOKEN is required}"
: "${APP_VERSION:?APP_VERSION is required}"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

git_sha="${GIT_SHA:-$(git rev-parse HEAD)}"

echo "==> building @t3tools/web for channel '$channel' as $APP_VERSION"

# VITE_BASE_PATH stays unset: this bundle is served at an origin root, not
# under the container's /z3/ prefix. VITE_HTTP_URL / VITE_WS_URL stay unset
# too — either one makes the app non-hosted and pins it to that one backend.
APP_VERSION="$APP_VERSION" \
VITE_HOSTED_APP_CHANNEL="$channel" \
VITE_HOSTED_APP_URL="$hosted_app_url" \
ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
PUPPETEER_SKIP_DOWNLOAD=1 \
CI=1 \
  vp run --filter @t3tools/web build

dist="apps/web/dist"
test -f "$dist/index.html" || { echo "build produced no $dist/index.html" >&2; exit 1; }

# msw writes its dev worker into apps/web/public on a local `msw init`, and
# vite copies public/ into dist. Nothing registers it; it still has no
# business on a public origin. Absent on a fresh clone, hence -f.
rm -f "$dist/mockServiceWorker.js"

# What the check at the end reads back. Without it a deploy that never rolled
# over is indistinguishable from one that did: the previous version keeps
# answering 200 either way.
printf '{"version":"%s","channel":"%s","sha":"%s","builtAt":"%s"}\n' \
  "$APP_VERSION" "$channel" "$git_sha" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  > "$dist/version.json"

echo "==> deploying to $channel ($service_id)"

# Keep zcli's session out of the developer's own: a bare `zcli login` would
# overwrite whoever is logged in on this machine.
zcli_state="$(mktemp -d)"
trap 'rm -rf -- "$zcli_state"' EXIT
export ZEROPS_CLI_DATA_FILE_PATH="$zcli_state/cli.data"
export ZEROPS_CLI_LOG_FILE_PATH="$zcli_state/zcli.log"

zcli login "$ZEROPS_TOKEN"

# --working-dir apps/web puts `dist` at the archive root, which is what
# `routing.root: dist` in zerops.yml resolves against; --zerops-yaml-path is
# read relative to the working directory, so it climbs back to the repo root.
zcli service deploy \
  --service-id "$service_id" \
  --setup z3web \
  --working-dir apps/web \
  --zerops-yaml-path ../../zerops.yml \
  --path-to-file-or-dir dist \
  --version-name "$APP_VERSION"

echo "==> verifying $smoke_origin/version.json carries $git_sha"

for attempt in $(seq 1 40); do
  served="$(curl -fsS --max-time 10 "$smoke_origin/version.json" 2>/dev/null \
    | sed -n 's/.*"sha"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')" || served=""
  if [ "$served" = "$git_sha" ]; then
    echo "==> $channel is serving $APP_VERSION ($git_sha)"
    exit 0
  fi
  echo "    [$attempt/40] serving '${served:-<nothing>}', waiting for $git_sha"
  sleep 5
done

echo "deploy reported success but $smoke_origin never served $git_sha" >&2
exit 1
