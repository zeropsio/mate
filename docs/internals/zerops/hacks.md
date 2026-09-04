# POC debt ledger

Everything knowingly wrong, temporary, or papered over. The POC is reconnaissance — shortcuts are
fine, forgetting them is not. Add an entry the moment a shortcut is taken, not at the end.

`in place` = already true in the tree. `planned` = a shortcut this POC intends to take.

For an entry whose **Where** is `zcp`, the POC tree is `../zcp` on branch `feat/z3-container`, never `main`; for one whose **Where** is this fork, POC code lives at tag `poc-2026-08-28` — see `README.md`, "Reading POC-era entries".

---

### H-01 · Region hardcoded to `prg1` · paid back

**Where was** `apps/web/src/zerops/api.ts`, `apps/mobile/src/features/zerops/zerops-api.ts` — the
region constant is now gone from both; the fix lives in `packages/client-runtime/src/zerops/api.ts`.
**Fix** `buildZeropsContainerUrl` takes the region as a required fourth argument instead of assuming
`prg1`. It comes from `zeropsRegionFromPublicZone`, which parses the project's `publicZone`
(`"fte23….prg1-zerops.zone"` → `"prg1"`) — already part of the project detail response both clients
fetch, so this needs no extra request. Verified live against `eval` (2026-08-27): `publicZone` parses
to `"prg1"`, matching the real `zeropsSubdomain` env value byte-for-byte.
**Why not `zeropsSubdomain`** The original entry also named the service env `zeropsSubdomain` (the
full container URL) as a fix, and called it data "already fetched by the clients" — that turned out
not to be true. Reading it means a new `/service-stack/{id}/user-data` request neither client
currently makes, scoped to one service. `publicZone` needs nothing extra and covers every service in
a project, not just `zcp`, so the fix uses that instead.

---

### H-02 · Pairing is minted behind a long-lived shared secret · superseded (2026-09-04)

**Superseded** by the Zerops-identity door (spec §3.2, decision D1): nothing is minted any more. A project member exchanges their own Zerops token at `POST /api/auth/zerops-identity`; the `/z3-pair` location, the sidecar on 127.0.0.1:3774 and the rate-limit zone are gone from zcp. The text below is the POC record.

**Where** `zcp` — `location = /z3-pair/{{.Password}}` in
`internal/content/templates/nginx.conf.tmpl`, mirroring the existing `/zcp-auth/{{.Password}}`
path-token pattern exactly, rate-limited (`limit_req zone=z3pair burst=20 nodelay;`, see H-16).
Proxies to `internal/z3sidecar`, a loopback-only (127.0.0.1:3774) HTTP listener supervised via
`startCommands` in `deploy/zcp-container.yml` — the exact same `zcp service start z3sidecar`
ExecStart shape as nginx/vscode, no `zsc unit create` involved (H-05 was rewritten once this
landed). Its `/` route checks `VSCODE_PASSWORD` is set too — belt-and-suspenders: nginx already
omits the whole location when it isn't, but a container with no auth gets a plain 404 from the
sidecar itself, never a mint, even on a direct hit. It then derives the public mate origin from
`zeropsSubdomain` (H-01's fix, never `prg1` — see verified.md for a live-found quirk: it is
newline-joined, one URL per declared port, on a multi-port service like this one), and runs
`npx t3@<pinned> auth pairing create --base-dir <same base-dir mate itself
uses> --base-url <origin> --json`, returning `{credential, expiresAt, origin}` with
`Access-Control-Allow-Origin: *` (see H-15).
**Status** Live-verified end to end against `z3probe`, 2026-08-27, including across a real service
restart: `GET /z3-pair/<password>` returns a usable credential, a wrong password gets no mint
(302, same cookie gate as everything else), and the credential drives the FULL chain — RFC 8693
token exchange at mate's own `/oauth/token`, a ticket from `/api/auth/websocket-ticket`, a real
`wss://…/ws?wsTicket=…` connection that opens successfully. See verified.md for the exact requests.
**Why** mate lives on its own declared port with its own auth, so it has no cookie gate and therefore
no proof that a caller is entitled to a pairing credential. The 8080 origin already has one —
`VSCODE_PASSWORD`, readable only by a project member through the authenticated Zerops API — so the
mint endpoint borrows it rather than inventing a second scheme.
**Blast radius** `VSCODE_PASSWORD` is long-lived and shared. Anyone who has ever held it can mint
agent access indefinitely, and revoking access means rotating it, which also signs everyone out of
code-server. Not worse than the status quo — code-server access already means a terminal in the
container — but it is a shared secret doing a per-user job.
**Real fix** Mint against the caller's own Zerops identity rather than a container-wide password:
the client presents its Zerops session, the container verifies it against the API and checks project
membership. Then revocation is per-user and nothing is shared.

---

### H-03 · Pairing credential carried out by hand over SSH · superseded (2026-09-04)

**Superseded** by the Zerops-identity door (spec §3.2): no credential leaves the container, by hand or otherwise. The text below is the POC record.

**Where** `poc/pair.sh`; mobile's Settings → Zerops connect form.
**Why** Nothing mints the credential automatically yet, so a human SSHes in and copies it out.
**Blast radius** Every project connection needs VPN and SSH, which is what stops the flow working
from a browser or a phone.
**Real fix** The `/z3-pair` endpoint described in H-02. Once that exists this entry dies, and with
it the only reason VPN appears in the product flow at all.
**Web-side progress** `apps/web/src/components/zerops/connect.ts` implements the consuming half of
H-02's flow — read `VSCODE_PASSWORD`, `GET {mintOrigin}/z3-pair/{password}`, `connectPairing` —
behind `ZeropsProjectPicker`'s one-click "Connect". The mint endpoint it calls now exists and is
live-verified server-side end to end on `z3probe` (H-02) — `GET /z3-pair/<password>` returns
exactly the `{credential, expiresAt, origin}` shape `connectPairing` expects. What's unverified is
this specific file's flow completing from an actual browser click; that's this slice's job, not
container-side. This entry stays open until that has run once end to end.

---

### H-04 · Web and mobile use different Zerops auth models · paid back

**Where was** web pasted an Integration Token into `localStorage`; mobile did the real
email/password + TOTP + refresh flow, in its own `apps/mobile/src/features/zerops/`.
**Fix** The mobile session client moved to `packages/client-runtime/src/zerops/`. `api.ts`'s
`ZeropsApiClient` now accepts either credential kind (`ZeropsCredential`: `session` from the account
login flow, or a non-expiring, org-scoped `token`) behind one request surface — callers of
`fetchClients`/`fetchAllProjects`/`fetchProjectOverview`/… don't branch on which is active, and a 401
against a token clears it instead of trying to refresh. `session.ts` persists either kind behind an
injectable storage adapter. Mobile kept its SecureStore adapter (`zerops-session-store.ts` is now a
thin wrapper); web got a `localStorage` one plus a real sign-in flow —
`apps/web/src/zerops/session.tsx` (`ZeropsSessionProvider`) mirrors mobile's auth state machine, and
`apps/web/src/components/zerops/ZeropsSignIn.tsx` is the email/password + TOTP/recovery UI. The
Integration Token path survives underneath as an explicit, collapsed alternative, not the default.
**Residue, paid back** `ZeropsSignIn` is now mounted in `ZeropsSettings.tsx`: signed out (or mid-2FA)
shows it directly; signed in shows `ZeropsProjectPicker` plus a sign-out control. The old bare token
gate, and the per-row `ServiceResolution`/manual pairing-code form built around it, are gone.

---

### H-05 · Container-side mate installed via unpinned `npx t3@latest` · paid back

**Where was** `zcp` — the init command ran `npx t3@latest`, and nothing supervised it. An
intermediate design (this entry's own earlier text, superseded before ever being deployed)
additionally used `zsc unit create` and needed one manual SSH bootstrap per container, because
`zcp init z3` had no `startCommands` line to fire it. Both are now resolved together.
**Fix** `internal/mate/mate.go` pins the version in one named constant (`PinnedVersion = "0.0.35"`,
`PackageSpec = "t3@" + PinnedVersion`) — every `npx` call in the codebase resolves through it, and
bumping it is the one place that touches. `internal/service/service.go`'s `"mate"` exec config
(`npx --yes t3@0.0.35 serve --mode web --host 0.0.0.0 --port 3773 --base-dir /home/zerops/.t3
--no-browser /home/zerops/app` — see H-17 for why the workspace path moved off `/var/www`) runs the
same way as the existing `"nginx"`/`"vscode"` entries: signal forwarding, logging, TasksMax
tuning if declared. It is wired up via `deploy/zcp-container.yml`'s `run.startCommands`, a
`{name: mate, command: zcp service start mate}` entry sitting right next to nginx/vscode's — the exact
mechanism this repo initially assumed was unreachable (zcp@1's own service YAML is platform-owned)
turned out to just need a checked-in recipe file someone applies, not a workaround. Same shape for
`internal/z3sidecar` (H-02) as `"z3sidecar"`.
**Verified** Live-tested on `z3probe` (project `p`) across a genuine `zcli service stop` +
`start` cycle, 2026-08-27: both units came back on their own with zero manual intervention —
`/healthz` reported `mateUp: true` again within ~10s of the container coming up, and a fresh mint +
full pairing chain (H-02) completed immediately after. Durable by construction, exactly as
predicted — no residual bootstrap gap, and `questions.md` Q-01 (whether a `zsc unit create` unit
survives a full restart) is moot for mate/z3sidecar specifically since neither uses that primitive
any more.
**Residue** `npx` still resolves the package fresh at every container start rather than an
image-baked install — a network dependency in principle (measured 2026-08-28, S0.10: on an
image-fresh container after a redeploy, unit start → `mateUp` took **58 s**; after a plain restart
with a warm cache, 4 s), though the npm cache is warm after the
first run and mate/z3sidecar share one pinned version so there's exactly one thing to fetch. This
mirrors the same class of boot-path network dependency `install.sh` already has for `zcp` itself
(`plans/research/zcp-install-delivery-architecture-2026-08-24.md`'s F1) — not re-litigated here as
a separate hack.

---

### H-06 · Pre-made project instead of one created at sign-in · planned

**Where** the demo flow's "you land in a project"
**Why** Creating a project on sign-in costs money per sign-in and takes minutes to provision.
**Blast radius** The demo only works for the one account the project belongs to.
**Real fix** Project create + import of the zcp service YAML through the API. Both exist; the
question is product, not feasibility.

---

### H-07 · No external signal that a container is initialised · paid back

**Where was** `zcp` had no status endpoint, marker, or env var readable from outside.
**Fix** `location = /healthz` in `internal/content/templates/nginx.conf.tmpl`, deliberately OUTSIDE
the `{{- if .HasAuth}}` gate (a client needs this before it has a pairing credential). Proxies to
`internal/z3sidecar`'s `/healthz` route, which always answers `200` with the interesting signal in
the body: `initComplete` (+ `initAt`) reflects whether `internal/init.Run` reached the end of its
step list this boot — it writes `<baseDir>/.zcp/state/init-complete` right before printing "Init
complete", read back via the absolute `mate.InitMarkerPath` — and `mateUp` is a live 2 s TCP dial
against `internal/mate.ServePort`, so a mate crash after a clean boot still shows up (the marker alone
would miss it). Since nginx itself only starts after every `initCommands` entry finishes
(verified.md), `/healthz` answering at all already proves that boot's `zcp init` reached the end of
its step list too — the marker mostly exists so `/healthz` doesn't have to special-case that
reasoning, and so a later addition to `Run()`'s step list has somewhere to report into without a
nginx template change.
**Residue** Only reports two booleans, `mateUp` alongside `initComplete`/`initAt` — nothing about
_which_ `Run()` step succeeded or failed. H-08 (mount status) was evaluated for the same route and
skipped as more than a thin wrapper — see H-08 and the report on this slice.

---

### H-08 · Mount listing requires a shell in the container · in place

**Where** `zcp` computes mount state live from `/proc/mounts`, readdir and `systemctl`
**Why** There has never been a reader outside the container.
**Blast radius** "What is under this project" cannot be answered over HTTPS; it needs the mate server
to already be running and to shell out.
**Real fix** Have `zcp` write a manifest, or expose mount status over the same authenticated
endpoint as H-03.

---

### H-09 · VPN needs root and is desktop-only · in place

**Where** `zcli` shells out to `wg-quick up`, which creates the utun, sets routes and writes
`/etc/resolver/*`
**Why** Inherited — this is how `zcli` has always worked.
**Blast radius** Any flow that depends on VPN cannot run on a phone and cannot run unattended.
Adding the user to a sudo group does **not** help: on macOS `sudo` still prompts for a password
regardless of group membership.
**Real fix** For the narrow case of "dial one SSH connection", a userspace WireGuard in netstack
mode needs no root at all — no interface, no routes, no DNS changes. For a general VPN, a
privileged helper installed once, the way Tailscale and Docker Desktop do it. Note the VPN
handshake itself is plain REST and needs no `zcli` — only the data plane does.

---

### H-10 · Mount state and thread history live in the container · in place

**Where** by design — the server runs where the code is
**Why** That is the whole point of the architecture.
**Blast radius** Rebuilding a container silently loses thread history. Dynamically added sshfs
mounts are not reconstituted on restart either — only those listed in `ZCP_SSHFS_HOSTNAMES` are.
**Real fix** Decide deliberately what is disposable. At minimum, warn before a rebuild.

---

### H-11 · A project is only reachable while its container runs · in place

**Where** inherent to running the server in the container
**Why** Not addressed yet.
**Blast radius** Either you pay for idle containers or your projects are intermittently gone.
**Real fix** Scale-to-minimum plus wake-on-connect.

---

### H-12 · No dependency topology is drawn · in place

**Where** the `/zerops` project detail view
**Why** `connectedStacks` comes back empty on every service, so any edge would be invented.
**Blast radius** None today — this is the correct call. Recorded so nobody "fixes" it by guessing.
**Real fix** Draw edges when the API returns real ones.

---

### H-13 · Upstream identifiers not renamed · in place

**Where** the `t3code:` localStorage prefix (~35 keys) and the `t3code://` URL scheme
**Why** Renaming the prefix drops every user's saved theme, settings and drafts without a migration;
the scheme is registered with Clerk for OAuth callbacks and needs external coordination.
**Blast radius** Cosmetic, but visible to anyone who opens devtools.
**Real fix** A storage migration, and a coordinated scheme change.

---

### H-14 · Git checkpointing over sshfs · paid back (2026-08-28)

**Paid back by stream S3** (`../z3` branch `z3`, `apps/server/src/zerops/ZeropsGitSpawner.ts` + `ZeropsCheckpointTargets.ts`): git never runs against the mount — every invocation is `ssh <host> git -C /var/www …` over one ControlMaster per host, checkpoints fan out per mounted repository under one ref name, restore leaves untracked files. Live-audited on `z3-eval` (verified.md, "S3 — live audit"): 0 git processes on the container, 0 argv on a mount path. The original text is kept below for the record.

**Superseded:** the original "real fix" below (a local workspace root, mounts as read-only context) is the opposite of the product decision: the workspace IS `/var/www` with the mounted dev services (brief D3/D4), and S0.3 measured the way out — run git ON each dev service over a multiplexed SSH connection (1.37 s per turn vs 12.7 s over the mount). Stream S3 implements that; this entry dies when it lands.

**Where** every turn is bracketed by a git checkpoint on the workspace root
**Why** Inherited from upstream, which never had network-mounted workspaces.
**Blast radius** A project root that is an sshfs mount makes every turn slow. Measured on a trivial
repo only (8 files, 60 ms) — a real repo will be worse.
**Real fix** Keep the project root a real local directory and keep mounts outside it. Surface
mounts as read-only context, never as a workspace root. `/var/www/app`, this entry's original
suggestion, turned out to be unsafe on its own terms — any sibling hostname can claim a path under
`/var/www` with no collision check (H-21), and a sibling literally named `app` is confirmed to
exist in the project this was tested against. `zcp` now uses `/home/zerops/app` instead; see also
H-17 for the same reasoning applied to the web mounts panel.

---

### H-15 · The `/z3-pair` mint response uses `Access-Control-Allow-Origin: *` · superseded (2026-09-04)

**Superseded**: the `/z3-pair` endpoint no longer exists (spec §3.2). The door's own origin policy is the allowlist in spec §3.4. The text below is the POC record.

**Where** `zcp` — `internal/z3sidecar/z3sidecar.go`'s `handleMint`
**Why** The caller is the mate web app, a different origin than the container, so the mint response
needs a CORS header for `fetch()` to read it at all. `*` was chosen deliberately over echoing the
request's `Origin`: the URL itself already carries the secret (the raw `VSCODE_PASSWORD` as a path
segment, H-02's pattern), so a wildcard adds no exposure beyond what a leaked URL already grants —
whoever can construct the URL can already mint. Keeping the request a plain `GET` with no custom
headers avoids a CORS preflight (`OPTIONS`) entirely, which is why the endpoint takes no
`Authorization` header or other simple-request-breaking input.
**Blast radius** None beyond H-02's own: anyone who can read the URL (i.e. anyone who could already
mint by curling it directly) can now also do so from a browser tab on any origin. No new secret
exposure, only a new client shape that can reach it.
**Real fix** Falls out of H-02's real fix: once minting is bound to the caller's own Zerops session
rather than a shared password, echoing the specific caller's `Origin` (or a small allowlist) becomes
meaningful. Wildcard CORS on a shared-secret URL is not worth narrowing on its own.

---

### H-16 · `/z3-pair`'s rate limit may collapse to one shared bucket behind the Zerops L7 · superseded (2026-09-04)

**Superseded**: the `/z3-pair` location and its `limit_req` zone no longer exist (spec §3.2). The text below is the POC record.

**Where** `zcp` — `limit_req_zone $binary_remote_addr zone=z3pair:10m rate=10r/s;` +
`limit_req zone=z3pair burst=20 nodelay;` in `internal/content/templates/nginx.conf.tmpl`
**Why** The brief for this endpoint asked for "at least do not make it trivially loopable," not a
fairness guarantee, and nginx's own `limit_req` is the existing facility for that — no custom
machinery. It is keyed on `$binary_remote_addr`, nginx's view of the immediate TCP peer. Whether
that is the real caller's IP or the Zerops L7 balancer's own address depends on the same mechanics
`internal/ingest`'s `clientIP()` already documents as a CLAUDE.md trap: on the shared
`*.zerops.app` subdomain, `X-Real-IP` (the balancer-authoritative header) is "the constant proxy
addr (one global bucket)" for that ingest endpoint. This container's nginx sits behind the identical
L7, so `$remote_addr` may be similarly constant across callers rather than one bucket per real
client — not independently re-verified here, carried over as the same caveat.
**Blast radius** In the worst case, the rate limit is one shared bucket for the whole container
rather than per-caller: a legitimate burst from one caller could transiently 503 another. Given the
endpoint is already gated behind `VSCODE_PASSWORD`, the threat this defends against is accidental
tight-loop hammering, not multi-tenant fairness, so a shared bucket still does its job. The numbers
are therefore chosen _for_ a shared bucket: the original `1r/s`/`burst=3` was tight enough that the
product's own flow would trip it — one person connecting a few projects in succession, or a single
retry, exhausts a budget every caller shares — so it is `10r/s`/`burst=20`. That still stops a tight
loop, which is all it is for.
**Real fix** Confirm live whether `$http_x_real_ip` (or a custom-domain deployment, per the
telemetry doc's "v2" note) carries the real per-client IP on this container's origin, and key
`limit_req_zone` on that instead if so.

---

### H-17 · The `/var/www` mounts panel skips its workspace-root exclusion when no project has loaded yet · in place

**Where** `apps/web/src/components/zerops/mounts/ZeropsMountsPanel.tsx`
(`useEnvironmentWorkspaceRoot`), joined in `mountJoin.ts`'s `joinVarWwwMounts`.
**Why** The panel excludes the connected environment's own workspace root from the mount list by
matching it against `useProjects()` scoped to that `environmentId` — no hardcoded path guess (unlike
the `/var/www/app` constant another agent is retiring in `zcp` for the same reason: it collided with
a sibling service literally named `app`). If no project has shown up for that environment yet
(`useProjects()` returns nothing scoped to it — plausible right after a fresh connect, before the
environment's shell has bootstrapped), `workspaceRoot` is `null` and `joinVarWwwMounts` does not
filter at all, rather than guessing a name to exclude.
**Blast radius** In that narrow window, the workspace root would render as an ordinary (likely
unmatched) mount row for one panel load. Never wrong data, just an extra row until a project loads
and the panel naturally excludes it.
**Real fix** None needed beyond what's here: derivation already covers the normal case. If this
window turns out to matter in practice, the fix is waiting for `useAllEnvironmentShellsBootstrapped()`
before rendering the list, mirroring how the landing flow (`ZeropsSignedInLanding`) already waits on
it before deciding anything.

---

### H-19 · The Zerops landing and the project picker fetch candidates independently · in place

**Where** `apps/web/src/components/zerops/landing/ZeropsSignedInLanding.tsx` and
`apps/web/src/components/zerops/ZeropsProjectPicker.tsx` each call `useZeropsCandidates()` on their own.
**Why** Both need the grouped-candidate decision independently and neither can receive it from
outside — the landing must know whether exactly one project is already connected _before_ it decides
to render the picker at all, and the picker is a frozen, self-contained component.
**Blast radius** Landing on the picker (the common case) fires `fetchAllProjects` plus one
`fetchProjectOverview` per active project twice in a row. Not a loop, and not visible beyond a couple
of extra round-trips on that screen. The project detail view was briefly a third caller; it now uses
`resolveConnectedEnvironmentId` against the overview it has already fetched, so it adds nothing.
**Real fix** Share one `useZeropsCandidates()` result across all three — lift the fetch into a small
context/atom every caller reads, rather than each mounting its own copy of the hook.

---

### H-20 · Reading `VSCODE_PASSWORD` bypasses `ZeropsApiClient`'s typed request surface · in place

**Where** `apps/web/src/zerops/api.ts`'s `fetchZcpVscodePassword`
**Why** The one-click connect flow (C2) needs an authenticated `GET
/service-stack/{id}/user-data`, which `ZeropsApiClient` (in
`packages/client-runtime/src/zerops/api.ts`, out of this slice's scope) has no generic method for —
only specific typed fetches (`fetchUser`, `fetchProjects`, …). Rather than add one to a package this
slice doesn't own, `fetchZcpVscodePassword` does its own raw `fetch` with the active credential's
access token read off `zeropsClient.credential`.
**Blast radius** This one call doesn't get the class's coalesced-401-refresh behavior: if the access
token happens to be expired at exactly this moment, it fails with "session expired" instead of
silently refreshing and retrying like every other Zerops API call in the app does. Narrow — the
token is good for the life of the session in normal use — but inconsistent.
**Real fix** Give `ZeropsApiClient` a generic authenticated `request<T>(path, init)` method (or a
narrow `fetchServiceUserData(serviceId)`) that the rest of its typed methods can be expressed in
terms of, and have this call go through it.

---

### H-21 · An sshfs mount can silently shadow whatever already lives at its target directory · in place

**Where** `zcp` — `internal/platform.SystemMounter.Mount` and `internal/init.mountSSHFS`
(`init_sshfs.go`), the two call sites that create an sshfs mount.
**Why** Neither checks whether the target directory (`/var/www/<hostname>`) already has real
content before mounting over it. `Mount` only `os.MkdirAll`s the path (a no-op if it already
exists) and goes straight to `zsc unit create`; there is no `os.ReadDir` / emptiness check anywhere
in either path (confirmed by grep, 2026-08-27). FUSE mounts don't delete what's underneath — the
prior contents reappear on unmount — but they become invisible for as long as the mount is active,
with no warning that anything was there.
**Blast radius** Today this only matters for a directory a human put real content into by hand
under `/var/www` before a matching-hostname sibling gets mounted (or before `ZCP_SSHFS_HOSTNAMES`
is set on a container that already has one) — an edge case, not a common path. It was investigated
as part of relocating mate's own workspace off `/var/www` (H-17): mate's directory was exactly this
kind of pre-existing, real, git-tracked content, and would have been silently shadowed the moment a
sibling literally named `app` (which exists in the project this was tested against) got mounted.
**Real fix** Have `Mount` refuse (or at least warn) when the target directory is non-empty and not
already a mount point — `os.ReadDir` before `zsc unit create`, mirroring the stale-vs-active
distinction `CheckMount` already draws for the mount itself.

---

### H-22 · Connecting a container lands the user in an empty environment · in place

**Where** the container side registers no mate project; `zcp init` only creates the workspace
directory (`internal/init/init_mate.go`), and `t3 serve` takes it as a cwd, not as a registered project
**Why** Nothing in the flow bootstraps `/home/zerops/app` as a mate _project_. Serving a directory and
having a project record for it are different things.
**Blast radius** Breaks the "no human steps in between" promise at the last step. Verified in a
browser on 2026-08-27: pairing to `z3probe` succeeds and the environment registers, but the app then
shows "No projects yet", and the user has to walk Add project → environment → Local folder → `app` →
Add before they reach a thread. Everything after that works — the composer opens against the
container with its installed agents available.
**Real fix** Have the container register the workspace as a project at init, or have the client
create it right after a successful pair, so connecting ends in a thread rather than an empty
environment.

---

---

### H-23 · Dev builds are delivered by hand and a container restart wipes them · in place

**Where** the dev loop — `../zcp/eval/scripts/mate-dev-push.sh [zcp|mate|all]` (brief §4a in
`../zcp/plans/z3-brief-2026-08-28.md`). Nothing is released while mate is built: the zcp binary
and the forked server (`cli.ts build` → `cli.ts pack` → `npm install` into
`/home/zerops/.zcp/mate` on the container) go in over VPN + ssh. Target: project `z3-eval`
(`nTV3oMB2SS634ImDJnQckg`), service `zcp` (`gt7tJZjDSk2zyH5XvNeAQQ`).
**Why** a release is slow to iterate on and the pool hands a new zcp to fresh projects only after
midnight; hand delivery means build → try → throw away within minutes.
**Cost** the platform recipe runs `install.sh` (unpinned → latest _release_) on every container
start, so any restart replaces the dev binary and `zcp init z3` with it — push again after every
restart, and restart only to measure S0.2. The web client never goes in (`vite dev` on the
laptop against the container), so `http://localhost:*` is on the mate Origin/CORS allowlist.
**Owner decision 2026-08-28 (end of day 1)** hand delivery stays the ONLY channel until
further notice, and **no zcp release from `main` while the `zcp init z3` step is unconditional**
(`../zcp/internal/init/init_mate.go`): a release would, on every container restart fleet-wide,
fetch upstream `t3@0.0.35` (`z3.PackageSpec` — the fork is not published), i.e. no Zerops door
and no base path. Before anything else ships from `main`, the step needs a gate (opt-in service
env) or must leave `main`. Direction under consideration, NOT decided: mate on by default
everywhere (as the step is now), the bundle fetched from an own GitHub repo with releases in the
shape of zcp's `install.sh` (not the npm `t3` package), and a hard fork off t3 — own axis, no
`rebase upstream/main`. **Evening 2026-08-28:** the hard fork is decided and frozen
(`fork.md`, tag `upstream-base-2026-08-28`); "mate on by default everywhere" and the bundle channel
stay open for the release gate.
**Real fix** the release gate (brief §4a) once the direction above is decided: one release, then
the three "naked" acceptances — fresh `zcp@1` from the platform recipe answers
`/healthz {mateUp:true}`, a restart of an older container brings mate up, a brand-new pool account
reaches a thread untouched.
**First used** 2026-08-28 — zcp half verified on `z3-eval` (`zcp version` reports the local
commit after the push, `zcp init` + `nginx -s reload` clean); mate half see `verified.md`.

---

### H-24 · One subscription login copied into every test container · in place

**Where** the dev targets — `z3-eval`'s zcp has Claude logged in through the owner's
subscription; its credential artifacts (`~/.claude/.credentials.json`, `~/.claude.json`) are
stashed on the laptop outside every repo and copied into each further throwaway service.
**Measured 2026-08-28 (S0.8):** `~/.claude/.credentials.json` alone (mode 600) is the whole
working set — the container's own `~/.claude.json` keeps its `mcpServers`, no merge; the MCP
answers under the copied login; the access token lives ~8 h and two containers used it
concurrently without conflict (the refresh race past `expiresAt` is `questions.md` Q-12).
**Why** API keys are not a product path (subscription login is the point of the T3 fork), and
the in-container login flow is S7, phase 2 — until it exists, tests still need an authorized
agent.
**Cost** one identity in N containers; a token refresh in one container can invalidate the copy
in another — re-stash from the one that still works. The contents never get printed or
committed.
**Real fix** S7 — OAuth inside mate's own terminal, credential-file watch, `zcp agent mark-oauth`.

---

### H-25 · A login session's stall timer is a detached fiber that is never interrupted · in place

**Where** `apps/server/src/zerops/ZeropsAgentLogin.ts` — the per-session stall timer is `Effect.forkDetach`ed and `dispose` only removes the session from the active map and unsubscribes its output listener; the module header explains why.
**Why** This pinned Effect build has a scheduler bug when a `Stream.debounce`-driven fiber is interrupted through a scope close or a racing second fiber (the same class of issue `ZeropsAgentAuth.ts`'s header describes and works around).
**Blast radius** One dead fiber per login attempt: it checks the session's identity token before every action and goes inert once the token no longer matches, so the leak is bounded by the number of user-initiated agent logins, not by reconnects.
**Real fix** Interrupt the timer fiber in `dispose` once the Effect upgrade past the scheduler bug lands; then this entry is paid back.
