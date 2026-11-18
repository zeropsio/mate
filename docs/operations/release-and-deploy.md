# Release and deploy

How mate reaches users. Each step names the file that owns its detail.

- **CI.** CI runs lint/format, typecheck and build on `main`, `kh-bisect/**` and pull requests (a
  newer push cancels older runs except on `main`). Test suites and test machinery run only on a manual dispatch of CI or a
  `kh-bisect/**` manifest naming them; browser scenario shards only on a manual dispatch of the
  non-blocking `Signal` workflow, where a failure gets one same-commit rerun to tell a flake from a
  regression.
- **Landing.** `node scripts/land.ts` lands the checked-out commit on `main`: under a lock shared
  by every worktree it rebases onto `origin/main`, checks that `.mate-hq-ref` is on mate-hq's
  `main`, runs `scripts/gate-changed.ts` and fast-forward pushes, printing `LANDED <sha>`. It needs
  `MATE_HQ_CHECKOUT` set to a mate-hq clone; a refusal (`land: refused <class>: <reason>`, non-zero
  exit) pushes nothing unless its reason says the push may have landed. The command owns the queue and the bound, so a lane, a person and a script
  land alike and none adds its own lock or clock: it waits for the lock as long as another landing
  holds it (a holder that died releases it), and once it holds it the landing has
  `LAND_DEADLINE_SECONDS` (default 3600) before it is stopped and refused `timeout`. SIGINT or
  SIGTERM, queued or landing, ends it as `interrupted` within 5 s, so a caller that stops it waits 5 s
  before SIGKILL. Once the push has started, origin decides: when its `main` contains the pushed commit,
  the landing prints `LANDED <sha>` whatever stopped it. An invalid `LAND_DEADLINE_SECONDS` is
  refused `env`; a lock directory that names no holder (no landing makes one) is refused `lock`
  with its path, to be removed once no landing runs. A landing whose lists' delta (the sentence ids
  its `SENTENCES.md` changes retire, change or add) differs from `--sentences <id>[,<id>…]` is
  refused `sentences`; the lander passes the ids its card names.
  The push to `main` deploys the hosted web client.
- **Hosted web client.** `main` deploys https://mate.zerops.io through `zerops.yml`'s `prod` setup.
  Keep `main` releasable; one hard line: never break signing in with a Zerops account.
- **Staging web.** `zerops.yml`'s `staging` setup builds a test target's web (alfa, the standing
  test environments `env-N`) against that target's HQ, named by the web service's variable
  `MATE_HQ_URL` (`VITE_HQ_ORIGIN`); Mates born from it pin `T3CODE_ZEROPS_HQ_ORIGIN` to that HQ. It
  runs at its service's `zeropsSubdomain`; the build refuses a service without either. Deploy it
  from a checkout with `zcli push -P <project id> -S <web id> --setup staging`. From a linked
  worktree add `--workspace-state clean` (zcli's default state writes a temporary index into
  `.git`, which is a file there); it pushes `HEAD`.
- **Dev environments' web.** `zerops.yml`'s `dev` setup serves `https://mate.<host>` of each dev
  environment, one service per environment, named after it. Deploy a branch with the manual
  **Deploy dev Mate** workflow (`.github/workflows/deploy-dev.yml`).
- **Design harness.** Every `apps/web/design*.html` page over its fixtures, listed at `/design/`:
  the dev server always serves it, and a Mate's preview builds `zerops.yml`'s `preview` setup,
  `prod` with the harness beside the app (`VITE_DESIGN_HARNESS=beside`); production's `prod` never
  carries it. The `harness` setup builds it alone, in place of the app (`VITE_DESIGN_HARNESS=alone`):
  a static place to look at states with no account and no Mate. Deploy that from a checkout with
  `zcli push -P <project id> -S <service id> --setup harness`; nothing deploys it by itself.
- **Hosted client's service worker.** `prod` and `staging` build with
  `VITE_APP_SHELL_WORKER: app-shell`: `/sw.js` answers every load with the origin's page, so the
  first load after a deploy runs it, and keeps that page with its files behind it; the kept page
  answers only when the origin cannot (offline, an error status). To retire it, set the variable
  to `retire` and deploy: `/sw.js` becomes a worker that clears its caches and unregisters on each
  browser's next navigation. Keep that deploy up; deleting the variable or `/sw.js` leaves
  installed workers in place.
- **Shared production HQ.** Deployment is owned by the private `zeropsio/mate-hq` repository.
- **Mate server release.** `node scripts/release-mate.ts` (`--minor` when the client's compatibility
  floor rises, `--dry-run` prints the plan). It calls GitHub through `gh`; set `MATE_GH` to use a
  wrapper that holds the release token instead. zcp installs the latest stable release in containers by itself.
  A `main` commit may be released once its newest `ci.yml` run on `main` has completed with every
  required job green (`checkJobIds` in `scripts/ci-blame.ts`, the checks Release Smoke's verdict
  demands); a red informative job (tests, smokes, mobile) does not hold it. A missing run, a run
  still in progress and a required job not green are each refused with their own words. The
  release workflow asks the same verdict (`node scripts/ci-blame.ts --release-verdict`), and the
  lockfile policy check is part of `Check`.
  A source that changed no server artifact input since the last release (the sources the published
  artifact's sourcemaps name, plus the build tooling in `scripts/lib/server-artifact-inputs.ts`)
  cuts no release: the script prints `nothing to release` and exits 0; version-only edits never count.
  `--from-sha <sha> --would-release` makes only that decision: its last stdout line is `release` or
  `no-release`, and it cuts, tags and pushes nothing.
  A commit counts as released once a `v*` tag on origin is it or has it as parent, its GitHub
  release published or not: from any clone the script prints `already released: <tag> …` (and
  `no-release` with `--would-release`) and cuts nothing; a run on the newest such tag still waits
  until its publication completes.
  A run that may cut a release holds `<git common dir>/mate-release.lock` until it ends; a second
  run from the same clone or one of its worktrees prints `another release holds <path>; nothing cut`
  and exits 1. Between clones or machines the tag push decides: a run that finds another release
  tag for its source just before its push, or whose push origin refuses for one, prints
  `already released by <tag>` and publishes nothing.
- **Install check against a staged release.** Before promoting a release, run zcp's live seam case on
  an e2e container that has Mate enabled (`make e2e-deploy` in zeropsio/zcp, `ZCP_HOST` names the
  service): `ZCP_E2E_MATE_RELEASE=https://github.com/zeropsio/mate/releases/download/v<version>/stable.json
  /var/www/e2e-test -test.run TestMateInstall_Release_Serves -test.v -test.timeout 600s`. It installs
  that release through download → SHA-256 → install and waits for `mate serve` to be ready. Red
  means the release does not install or its `serve` rejects the launch argv or environment: do not
  promote it. The release stays installed on that container either way.
- **Unreleased server build in a running container.** `eval/scripts/mate-dev-push.sh {zcp|mate|all}`
  in a `zeropsio/zcp` checkout; `MATE_REPO` names this checkout when it is not at the script's
  default. It needs the project VPN and an explicit `EVAL_REMOTE_HOST`.
  It is not a release: without a dev pin a dev Mate build stays only until a release newer than its
  base is known. `zcp mate pin --for <duration> --reason <text>` keeps every dev build in the
  container (24 h by default, at most 7 days, the reason is required); `zcp mate pin --end` removes
  it and `zcp mate pin` shows it. A container restart replaces a dev zcp with the latest release
  whatever the pin says, but the pin, kept across the restart, still covers a dev Mate; a redeploy
  loses the bundles and the pin (`zeropsio/zcp:docs/spec-mate.md` §2.1a, §2.6).
