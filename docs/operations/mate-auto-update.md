# Mate automatic updates

Automatic updates are enabled by default on the stable channel. HQ has one organization-wide hold. An authenticated HQ administrator can read `GET /api/auto-update` and set `PUT /api/auto-update` with `{"enabled":false}` to hold, or `{"enabled":true}` to resume. Use the existing HQ admin account session; do not share or store its bearer credential in a runbook. Mate needs a fresh authenticated policy answer before draining and again before switching. A missing policy answer postpones the update.

Mate checks hourly with jitter through zcp's manifest resolver. Only a release with a proved rollback-compatible range covering the installed version can update automatically. Other releases use the confirmation path. The release manifest records `rollbackCompatible` and, when proved, `compatibleFrom`; missing evidence means confirmation is required.

An update waits for real engine work to finish. Active or queued runs, open approvals/questions/requests, process-bound effects, opening or closing sessions, background work, and a terminal with a running process all prevent switching. The drain deadline is ten minutes: reaching it postpones the update without interrupting the work. The candidate has fifteen seconds to prove readiness; a failed candidate rolls back to the explicit last-good install and is skipped until a newer release appears. Conversations keep their native Claude resume ID or Codex thread ID.

## Bring an older Mate onto this protocol

An old zcp cannot acquire the new update protocol just by restarting the Mate process. After the Mate release and its zcp pin have shipped, perform one attended full restart of the existing zcp service/container through the normal Zerops operator restart control. Container initialization reruns `install.sh`, replaces zcp, and reconciles the pinned Mate release. A service/container restart retains the home directory and conversation history. Redeploying the service replaces the container and is not this operation.

1. Confirm the organization, project and service identity, and record the current Mate version, boot ID and native provider session IDs. Coordinate connected users and automation so they submit no new work during the restart window.
2. Prove the environment idle from the engine and terminal state. Finish or resolve outstanding work; a lack of connected browsers or an HQ activity count does not prove idle. Postpone while any running terminal process or background work remains.
3. Perform the full service/container restart. Restarting only `zerops@mate` does not replace zcp and cannot bootstrap this capability.
4. Wait for the platform restart receipt and inspect both probes. `/mate/healthz` proves zcp initialization; `/mate/.well-known/t3/environment` must return JSON with `basePath:"/mate"` and the expected Mate version. A healthy init marker or an HTML SPA fallback does not prove Mate readiness.
5. In the container, read `zcp mate status --local --json` and require `updater.protocol:1`. Then `zcp mate status --refresh --json` reads the resolved release and effective rollback compatibility. Readiness is separately exposed at `http://127.0.0.1:3773/api/mate/update/readiness` with protocol, version, boot ID and ready state.
6. Reconnect and continue an existing conversation. Verify the original native Claude resume ID or Codex thread ID is reused. Record the observed outage from the old ready process to the new ready process before allowing new work.

Probe capabilities before invoking a new CLI mode or passing a new `mate serve` flag: an unknown serve flag is fatal. `zcp mate update --json` is the attended manual path. `zcp mate update --automatic --json` requires the updater protocol probe; its `started:true` acknowledgment means accepted work, not completed installation. Completion requires the live version/boot and readiness evidence.

Ship Mate first, then zcp's Mate pin and manifest handling. The first release introducing this protocol is conservatively ineligible for an automatic rollback from older releases. Keep the attended restart procedure available until those installations have been upgraded.
