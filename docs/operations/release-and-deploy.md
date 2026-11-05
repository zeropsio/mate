# Release and deploy

How mate reaches users. Each step names the file that owns its detail.

- **Hosted web client.** `main` deploys https://mate.zerops.io through `zerops.yml`'s `prod` setup.
  Keep `main` releasable; one hard line: never break signing in with a Zerops account.
- **Staging web.** `zerops.yml`'s `staging` setup builds the alfa test web against alfa's HQ
  (`VITE_HQ_ORIGIN`); Mates born from it pin `T3CODE_ZEROPS_HQ_ORIGIN` to that HQ.
- **Hosted client's service worker.** `prod` and `staging` build with
  `VITE_APP_SHELL_WORKER: app-shell`: `/sw.js` answers a reload with the page it kept and fetches the
  new one behind it, so a deploy runs on the second load after it. To retire it, set the variable to
  `retire` and deploy: `/sw.js` becomes a worker that clears its caches and unregisters on each
  browser's next load. Keep that deploy up; deleting the variable or `/sw.js` strands installed
  workers on their kept page. A person can always bypass it with a hard reload.
- **Shared production HQ.** Deploys from the private mate-hq repository's `scripts/deploy-hq.ts`.
- **Mate server release.** `node scripts/release-mate.ts` (`--minor` when the client's compatibility
  floor rises, `--dry-run` prints the plan). It calls GitHub through `gh`; set `MATE_GH` to use a
  wrapper that holds the release token instead. zcp installs the latest stable release in containers by itself.
- **Unreleased server build in a running container.** `../zcp/eval/scripts/mate-dev-push.sh
{zcp|mate|all}` (public zeropsio/zcp). It needs the project VPN and an explicit `EVAL_REMOTE_HOST`.
  It is not a release: a unit restart keeps the dev build, a container restart pulls the release back.
