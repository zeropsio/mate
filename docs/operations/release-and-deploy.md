# Release and deploy

How mate reaches users. Each step names the file that owns its detail.

- **CI.** CI runs lint/format, typecheck, build and T1 on `main`, `kh-bisect/**` and pull requests
  (a newer push cancels older runs except on `main`). Other test suites and test machinery run only
  on a manual dispatch of CI or through a `kh-bisect/**` manifest naming them.
- **Landing.** `node scripts/land.ts` lands the commit checked out when it starts on `main`.
  First, without the lock, it fetches, rebases onto `origin/main`, checks the sentence delta and
  that `.mate-hq-ref` is on mate-hq's `main`, numbers the branch's sentences and runs
  `scripts/gate-changed.ts --full` under `nice`: every refusal those steps give (`conflict`,
  `sentences`, `pin`, `env`, `gate`) comes without the lock. Then it queues for a lock shared by
  every worktree. Holding it, it fetches again: when `origin/main` has not moved it pushes the
  tree it gated; otherwise it rebases, repeats the checks and the numbering, and gates again with
  `--passed <the commit its gate passed>`, which runs the always-run stages and only the stages
  that read a file `main`'s new commits changed (every stage when a gate selection input changed),
  then fast-forward pushes, printing `LANDED <sha>`. Nothing carries the first gate's verdict but
  that commit id inside the landing's own process. It needs `MATE_HQ_CHECKOUT` set to a mate-hq
  clone; a refusal (`land: refused <class>: <reason>`, non-zero exit) pushes nothing unless its
  reason says the push may have landed; a `gate` refusal names each red stage with its full log
  (`gate red on <tip>: <stage> (<log path>)[; …]`, the gate's own last stderr line). The line before
  the last one is `land: waited <s> s, held the lock <s> s`. When a rebase, before the lock or
  under it, changes `scripts/land.ts` or a `scripts/` module it imports, the landing lets go of the
  lock and its place in the queue and runs the rebased `scripts/land.ts` in its place, with the same
  arguments; that run's last line and exit code are the landing's. A waiting landing whose commits do not merge with the
  local `origin/main` is refused `conflict` while it waits. The command owns the queue, so a lane,
  a person and a script land alike and none adds its own lock or clock: it waits for the lock as
  long as another landing holds it (a holder that died releases it), and holding it has no time
  limit. SIGINT or SIGTERM, queued or landing, ends it as `interrupted` within 5 s, so a
  caller that stops it waits 5 s before SIGKILL. Once the push has started, origin decides: when
  its `main` contains the pushed tip, the landing prints `LANDED <sha>` whatever stopped it. A lock
  directory that names no holder (no landing makes one) is refused `lock` with its path, to be
  removed once no landing runs. A landing whose
  lists' delta (the sentence ids its `SENTENCES.md` changes retire, change or add) differs from
  `--sentences <id>[,<id>…]` is refused `sentences`; the lander passes the ids its card names, an
  added sentence by its lane-local id (`ED+1`). The ids are numbered inside the rebased branch's
  last commit (amended, never a commit of its own, so a landing pushes only the branch's commits),
  the gate covers the numbered tip, and each `<unit>: <old> → <new>` is printed to stderr and
  added to that commit's body; a landing that does not land leaves its branch on its own rebased
  commit, before the numbering.
  `--onto whole/<name>` lands on a whole's branch instead, so changes that belong together reach
  `main` in one push, one CI run and one release: the first landing makes the branch from
  `origin/main`, and the branch is append-only until its close. A later landing rebases its own
  commits onto the branch head, never onto a `main` that moved, fast-forwards the branch with a
  lease on the head it saw, prints `LANDED <sha> on whole/<name>`, numbers nothing and gates by
  the branch rule. The close reaches `main` as one ordinary landing of the branch's head, naming
  every id the whole adds: a moved `main` is met there once, rebased and gated once.
  A landing on `main` does not itself release the hosted web client.
- **Hosted web client.** A `web-v*` tag deploys https://mate.zerops.io through `zerops.yml`'s `prod`
  setup. Release with `node scripts/release-web.ts` (add `--minor` for a minor version,
  `--from-sha <sha>` for a green `main` commit, or `--dry-run` to print the plan), or run **Release
  hosted web** on `main` in GitHub Actions. The script uses `gh`; set `MATE_GH` to a release-token
  wrapper if needed. It requires the same green CI verdict as the server release, skips a commit
  already included in a web tag, and prints `nothing to release` when no web build input changed.
  Once the script is on `main`, set the production web service's Zerops pipeline trigger to **New
  Tag** with regex `^web-v` and setup `prod`. Until that switch, `main` still deploys it. Keep
  `main` releasable; never break signing in with a Zerops account.
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
