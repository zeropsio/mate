# Hosted web CD — a parked design, and what it proved on the way

**Status: parked 2026-09-01.** `main` took a different route the same afternoon
(`129e60a33`, `0f2a69806` — Zerops-side `buildFromGit` on a GitHub branch
integration, service `app` behind an L7 balancer at `mate.zerops.io`). This
branch is not a competitor to that; it is the work and, more usefully, the
facts underneath it, kept somewhere they can be read when the question comes
back. Nothing here has been merged and nothing on `main` was changed.

## What it proposed

Build `apps/web` in GitHub Actions and ship the built directory with
`zcli service deploy`, rather than uploading the repository and rebuilding it
on Zerops.

Two channels, one trigger each, no path filters — `apps/web` shares
`packages/*` with the server, so a path filter either matches nearly every
commit or leaves a channel on a stale bundle when a shared package changed:

| channel | trigger        | service                  | label   |
| ------- | -------------- | ------------------------ | ------- |
| nightly | push to `main` | `z3-eval/z3web`          | Nightly |
| latest  | tag `v0.0.0`   | a service in `mate-prod` | Latest  |

Deliberately independent of `release.yml`: the hosted client and the server
tarball are two artifacts for two consumers, and the client already tolerates
older servers by construction — every field of
`ExecutionEnvironmentCapabilities` is an optional key with a written
"absent on older servers" contract. Version lockstep between the hosted client
and the server zcp pins is neither achievable (the fleet holds a spread of
server versions; a container only moves when it restarts) nor required.

Files on this branch: `zerops.yml` (deploy-only), `scripts/deploy-web.sh` (the
single implementation), `.github/workflows/deploy-web.yml` (calls the script
and adds nothing), one `.gitignore` entry.

## Verified against a live Zerops service

This is the part worth keeping regardless of which delivery route wins. All of
it was measured against `mate-prod`, 2026-09-01, not read out of documentation.

| #   | Fact                                                                                                                                                                                                                                                                                                                                                                   |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `zcli service deploy` exists in released zcli v1.1.0 — but only under `service`; unlike `push` it has no root alias, so `zcli deploy` is not a command.                                                                                                                                                                                                                |
| 2   | `push` calls `PUT /app-version/{id}/build-and-deploy`, `deploy` calls `PUT /app-version/{id}/deploy`. The second starts no build container at all and ignores `build:`.                                                                                                                                                                                                |
| 3   | A `zerops.yml` setup needs only `setup:` — the live schema makes `build:` optional, so a deploy-only setup validates.                                                                                                                                                                                                                                                  |
| 4   | `deploy` collects files with a plain filesystem walk filtered by `.deployignore`, **not** through git. A gitignored `dist/` deploys fine.                                                                                                                                                                                                                              |
| 5   | `--working-dir apps/web --zerops-yaml-path ../../zerops.yml --path-to-file-or-dir dist` works: the yaml path is resolved against the working directory, and the `dist` prefix survives into the archive, which is what `routing.root: dist` resolves against.                                                                                                          |
| 6   | **A `routing.headers` value is interpolated raw into nginx's `add_header`.** One containing spaces or commas must carry its own quotes — `"'no-cache' always"`, not `"no-cache"`. Unquoted, `nginx -t` rejects the config and the deploy fails with a bare `commandExec exit status 1` and produces no log line on any channel. This cost four failed deploys to find. |
| 7   | Header precedence works the nginx way: `for: /assets/*` wins over `for: /*`, and the SPA catch-all still answers deep links under the broader rule.                                                                                                                                                                                                                    |
| 8   | `deploy.readinessCheck.httpGet {port: 80, path: /}` works on `alpine/static@1.0`.                                                                                                                                                                                                                                                                                      |
| 9   | `enableSubdomainAccess: true` in an import document is **not** honoured. The subdomain has to be enabled separately, via `PUT /service-stack/{id}/enable-subdomain-access`.                                                                                                                                                                                            |
| 10  | A freshly imported service can fail its first deploys transiently — `commandExec exit status 1` on both containers, then a platform `500` — and succeed unchanged on retry a minute later. Do not debug the config before retrying once.                                                                                                                               |
| 11  | `ZEROPS_CLI_DATA_FILE_PATH` (and `ZEROPS_CLI_LOG_FILE_PATH`) relocate zcli's session file, so a script can `zcli login` without overwriting whoever is logged in on that machine.                                                                                                                                                                                      |
| 12  | zcli v1.1.0 flags are kebab-case: `--service-id`, `--project-id`. A `--service-id` alone is enough; the project is derived.                                                                                                                                                                                                                                            |

### Numbers that drove the choice

|                                          |                                    |
| ---------------------------------------- | ---------------------------------- |
| `git archive HEAD` (what `push` uploads) | 204 MB, 84 MB gzipped              |
| of which `.repos/`                       | 126 MB across 12 961 tracked files |
| `apps/web/dist` (what `deploy` uploads)  | 64 MB, 15 MB gzipped               |
| of which `.js.map`                       | ~26 MB                             |

### Three defects in the pre-existing setup

Independent of delivery route, and none of them fixed on `main`:

1. **Nothing sets `APP_VERSION`.** `apps/web/vite.config.ts` falls back to
   `apps/web/package.json`, pinned at `0.1.0` and never bumped, so every
   deploy ever made reports itself as `0.1.0`. There is no `version.json`
   either, so what is live cannot be read back — and a deploy that never
   rolled over is indistinguishable from one that did, since the previous
   version answers 200 either way.
2. **The origin sends no `Cache-Control`.** Measured on both `z3.krls.cz` and
   `mate.zerops.io`: only `ETag`/`Last-Modified`. Content-hashed assets under
   `/assets` are revalidated on every page load; what `mate.zerops.io` returns
   today (`max-age=14400`) is Cloudflare's own default, which will cache
   `index.html` the same way and delay a deploy becoming visible.
3. **The eval surface labels itself "Latest".** `VITE_HOSTED_APP_CHANNEL` takes
   `latest` or `nightly` and `branding.ts` renders it; the dogfood deployment
   claims to be the released one.

### Two constraints on where the client can live

- **The origin must sit under `.zerops.app`, `.zerops.dev` or `.zerops.io`.**
  `apps/server/src/zerops/origin.ts` enforces that suffix rule in _every_
  user's container. `T3CODE_ZEROPS_ALLOWED_ORIGINS` is per-container, so a
  domain outside those three would have to be typed into every container in
  the fleet. `mate.zerops.io` satisfies it; `z3.krls.cz` only ever worked
  through a hardcoded entry (deleted in `129e60a33`) plus a per-container env.
- **A new origin needs a platform-side registration.** `buildZeropsAuthorizeUrl`
  sends `app=zerops-code` and the platform maps that mode to _its own_
  registered callback origin — the client deliberately names no destination.
  Until Zerops registers an origin for that mode, sign-in there bounces to
  whichever one is registered. Password sign-in is unaffected: the public
  Zerops API answers `Access-Control-Allow-Origin: *` (verified against three
  different origins), so it works from anywhere.

## What this conflicts with, if it is ever revived

`main`'s route and this one cannot share `zerops.yml`:

|              | `main` (live)                               | this branch                          |
| ------------ | ------------------------------------------- | ------------------------------------ |
| who builds   | Zerops, on every push to `main`             | GitHub Actions                       |
| delivery     | GitHub branch integration (`buildFromGit`)  | `zcli service deploy`                |
| `zerops.yml` | keeps `build:`, setup named for the service | no `build:`                          |
| channels     | one — `main` is production                  | nightly / latest, tag is the release |

Reviving this means turning the branch integration off, or both paths deploy
over each other. The infrastructure `main` already has — the service, the L7
balancer, the `mate.zerops.io` domain — is orthogonal and would be kept.

## Residue left behind

- **`mate-prod` holds a second static service, `web`** (`KT6aygSdQHiIvMTsEPRpjg`,
  2 containers, subdomain `https://web-257.ny1.zerops.app`), imported while this
  was being verified and now serving only a holding page. It duplicates `app`
  and is safe to delete.
- **`zeropsio/z3` has a repository secret `ZEROPS_TOKEN_PROD`**, a Zerops
  integration token scoped to the `mate-prod` project alone (client-level
  `NO_ACCESS`, `canCreateProjects: false`, ADMIN on that one project). No
  workflow on `main` reads it.
- A companion `ZEROPS_TOKEN_EVAL`, scoped to `z3-eval`, was never created, so
  the nightly leg has never run.
