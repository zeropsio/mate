# Open questions

Unknowns that block a real implementation. Each says what it blocks and how to settle it. When one
is answered it leaves this file — the answer becomes a `verified.md` row or a `map.md` edit.

---

### Q-08 · Does the VPN `instanceId` cleanly support the same user from several machines?

**Blocks** Whether a developer with a laptop and a desktop can both be connected to a project.
**Why unclear** `POST /project/{id}/vpn` takes an optional `instanceId` that appears to exist for
exactly this, but its semantics are not documented in any repo here.
**How to answer** Read the Zerops API spec, or register two keys with different `instanceId`s and
list the peers.

---

### Q-11 · Live registration + pool claim run

**Blocks** S4's "brand-new account reaches a thread" acceptance; confirms `zcpClaimed`, the timing until the claimed `zcp` is `ACTIVE`, and what `POST /registration` returns for a pool-aware signup.
**What is known** The exact request and the fallback calls are in `verified.md` S0.7. Registration cannot be driven from a foreign origin (Q-10, answered: the Turnstile key is hostname-bound), so the live run goes through the real GUI (`app.zerops.io/registration?zcp=true`, puppeteer) and measures the claim from the API afterwards — running 2026-08-28.
**How to answer** Owner supplies throwaway e-mail addresses; run the sequence; record `zcpClaimed`, the project id, and the time to `ACTIVE` with direct reads. Waiting on the owner as of 2026-08-28.
**Also record (2026-09-15)** the claimed project's `zcp-*` token as the new owner sees it: whether it appears in `GET /client/{id}/integration-token/list`, its name, `createdByUser` and grants, whether it carries a delegation, and whether the owner can lower it to `BASIC_USER` and delete that delegation. The Mate hardening in the backbone plan reaches pool-claimed Mates only through that owner's session.

---

### Q-12 · What happens when two containers holding the same copied Claude login both cross `expiresAt`?

**Blocks** How long the H-24 copied-login rig stays usable unattended, and whether S7's "one identity per container" premise has a hidden refresh-token race.
**What is known** (2026-08-28, S0.8) The access token lives ~8 h (`expiresAt` in `~/.claude/.credentials.json`); concurrent use inside that window by two containers caused no conflict and no refresh. Nothing was observed at or after expiry.
**How to answer** Leave a copy in a second throwaway container past `expiresAt`, run `claude -p` on both, diff the two credential files (`expiresAt`, mtime only — never contents) and see whether the second refresh is rejected.

---

### Q-13 · Why does the web GUI's "Add project" dialog hang on "Connecting…" against a loopback-bound server behind a tunnel/proxy?

**Blocks** Nothing on the product path (S2 auto-bootstraps the `/var/www` project and S4 never opens that dialog), but it may be the first symptom of the `loopback-browser` mis-classification (S0.9 web half) hitting a UI flow.
**What is known** (2026-08-28) `server.probe`, `server.getConfig`, `orchestration.dispatchCommand` over the same bearer answer instantly; only the folder-browse dialog never resolves (~40 s). Server started with `--host 127.0.0.1`, reached through an SSH tunnel.
**How to answer** Reproduce once S1's policy override is in (remote-reachable in Zerops mode); if it persists, trace the dialog's RPC (`filesystem.browse`?) in the browser's WS frames.

---

### Q-14 · Does Antigravity's managed ACP runtime pick up zcp's MCP registration?

**Blocks** offering Antigravity in mate with the `zerops_*` tools attached. zcp's Antigravity adapter
(`../zcp/internal/init/adapters/antigravity.go`) writes the MCP server into
`~/.gemini/config/mcp_config.json` for the installed Antigravity CLI. The ported driver
(`apps/server/src/provider/Drivers/AntigravityDriver.ts`, `antigravityRelease.ts`) downloads and
runs a managed `agy_acp_server` runtime with `mcpServers: []` (upstream's only per-thread MCP wiring
was the deleted T3 preview server). Whether that runtime reads the same config file is unknown.

**What is known** (2026-09-05) Static only: the two code paths above; nothing live.

**How to answer** On `z3-eval`, install Antigravity through the ported setup flow, start a thread and
ask the agent to list its tools; the answer is the presence of `zerops_workflow`. If absent, the fix is
on the zcp side (a `mcpServers` entry for the managed runtime) or an adapter option — a two-repo change
through spec §2.8.

---

### Q-15 · Do Claude mid-turn limit updates reach the Limits tab on the rig's Claude Code?

**Blocks** trusting the Limits tab's "pace" and reset countdown during a long Claude turn. On Claude Code
2.1.251 the streamed `rate_limit_event` carries utilization only under `unifiedWindows`, and upstream's
normaliser drops it (`compat.md` row 2 notes); the tab then updates only from the `get_usage` probe.

**What is known** (2026-09-05) The four recorded fixtures (2.1.251) lose the event; SDK 0.3.260's types
declare a flat `utilization` and no `unifiedWindows`, so a newer CLI may emit the flat field.

**How to answer** On `z3-eval` with a signed-in Claude subscription, run one turn and diff the Limits
tab before/after against `claude --version`; if it does not move, decide between porting a
`unifiedWindows` reader into the normaliser (a ported-zone divergence) and waiting for the CLI.

### Q-16 · What does removing a member with `force` delete, and what happens to their Mates?

**Blocks** the leave flow: every `zcp-*` token — a Mate's platform identity and operator key — is
owned by the person who created that Mate.
**What is known** (2026-09-15, `verified.md`, _A member's rights and the tokens they made_) Lowering
a person leaves their tokens' grants untouched; regenerating a token hands it to whoever regenerates
it, killing the old value; removing a member who holds tokens is refused (`409
deleteExistingApplicationTokens`). The OpenAPI says `force=true` deletes those tokens. Not measured:
whether `force` deletes every integration token the member created (their Mates' `zcp-*` keys
included) and their personal tokens, and what a running Mate does when its key disappears.
**How to answer** With an account that can be re-invited (its owner clicks the e-mail): have it
create a Mate-shaped project and token, remove it with `force`, read the org's token list and the
project's `userRoles`, and call the API with the token; then re-invite it.
