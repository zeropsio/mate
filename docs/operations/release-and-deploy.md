# Release and deploy

How mate reaches users. Each step names the file that owns its detail.

- **Hosted web client.** `main` deploys https://mate.zerops.io through `zerops.yml`'s `prod` setup.
  Keep `main` releasable; one hard line: never break signing in with a Zerops account.
- **Staging web.** `zerops.yml`'s `staging` setup builds the alfa test web against alfa's HQ
  (`VITE_HQ_ORIGIN`); Mates born from it pin `T3CODE_ZEROPS_HQ_ORIGIN` to that HQ. It runs at
  https://web-31d9.prg1.zerops.app, the `web` service of `mate-hq-staging`; deploy it from a
  checkout with `zcli push -P <project id> -S <web id> --setup staging`.
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
- **Install check against a staged release.** Before promoting a release, run zcp's live seam case on
  an e2e container that has Mate enabled (`make e2e-deploy` in zeropsio/zcp, `ZCP_HOST` names the
  service): `ZCP_E2E_MATE_RELEASE=https://github.com/zeropsio/mate/releases/download/v<version>/stable.json
  /var/www/e2e-test -test.run TestMateInstall_Release_Serves -test.v -test.timeout 600s`. It installs
  that release through download → SHA-256 → install and waits for `mate serve` to be ready. Red
  means the release does not install or its `serve` rejects the launch argv or environment: do not
  promote it. The release stays installed on that container either way.
- **Unreleased server build in a running container.** `../zcp/eval/scripts/mate-dev-push.sh
  {zcp|mate|all}` (public zeropsio/zcp). It needs the project VPN and an explicit `EVAL_REMOTE_HOST`.
  It is not a release: a unit restart keeps the dev build, a container restart pulls the release back.
