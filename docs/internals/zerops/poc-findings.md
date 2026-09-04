# POC findings — what the 2026-08 proof of concept taught, and where its code sits

The POC (branch `zerops-poc`, frozen as tag **`poc-2026-08-28`**) proved the whole chain end to
end: a T3 server inside a zcp container, a rebranded web + mobile client, Zerops sign-in, a
project picker, one-click connect, mounts, a Zerops page. It was reconnaissance, and it is not
the base of the product: the product restarts from `upstream/main` on branch `z3` with only
this directory (the ledger) and `apps/server/scripts/cli.ts pack` carried over.

What the POC leaves behind, in order of value:

1. **The ledger** — `map.md` (how the systems fit), `verified.md` (facts with the command that
   established them), `hacks.md` (every shortcut, with status), `questions.md`. Carried over
   whole; keep it alive.
2. **The seam map** below — every upstream T3 file the POC had to change _functionally_ to add a
   Zerops entry point, and why there. Renames and recolours are excluded on purpose.
3. **Functional facts** learnt while writing the Zerops modules — recorded here, the code stays
   at the tag as a reference. None of it is ported: the mint/pairing chain is replaced by D1
   (Zerops identity, spec §3), the picker and sign-in are rebuilt on the client (spec §4), the
   service map is a client projection of the Zerops API and the mounted set is read from the
   container's mount table (spec §0, §5.1, §6.1).
4. **Nothing else.** The branding commits (`poc(brand): …`), the `poc/*.mjs` codemods, the theme
   palettes, icons, wordmarks, README rewrites and the `t3code` → Zerops string changes have no
   carry-over value; the one fact they produced (brand teal `#00b1a3` on white fails AA, hence
   `#007e72`) is in `verified.md`.

To read any POC code: `git show poc-2026-08-28:<path>`.

---

## Seam map — where T3 had to be touched, and why there

Every entry is a place a Zerops-specific piece plugs into upstream. The reason column is the
finding; the path is where the S-stream doing that work will land again.

### Web (`apps/web`)

| Seam                                                                  | Change                                                                                            | Why there                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/AppRoot.tsx`                                                     | wrap `RouterProvider` (+ preview hosts, Electron host, quit overlay) in a `ZeropsSessionProvider` | The Zerops session (account token) is independent of T3's _environment_ auth gate, and Zerops routes (`/zerops`, `/settings/zerops`) are reachable through more than one branch of that gate — so the provider sits **outside the router**, not in the root route.             |
| `src/routes/_chat.index.tsx` — `HostedStaticOnboardingState`          | replace the "Connect an environment to get started" empty state with the Zerops hosted landing    | This component is the hosted/static client's "no environment yet" state — the natural entry for sign-in → project. The POC kept upstream's manual-connect flow reachable behind it (`ManualConnectFallback`) so a non-Zerops user is never locked out; **keep that property**. |
| `src/routeTree.gen.ts` + new route files                              | `/zerops` (projects page) and `/settings/zerops`                                                  | Generated route tree — new routes are new files under `src/routes/`, the tree regenerates.                                                                                                                                                                                     |
| `src/components/sidebar/SidebarChrome.tsx`                            | a "Zerops" utility item + active-state branch for `/zerops`                                       | The sidebar utility menu is a hard-coded list with a `location.pathname` switch; a new page needs both the item and the active-state case.                                                                                                                                     |
| `src/components/settings/settingsSearch.ts`, `SettingsSidebarNav.tsx` | `/settings/zerops` in `SettingsPath`, labels, icons, search items                                 | Settings navigation is a closed union type + three parallel records; a new settings page touches all of them.                                                                                                                                                                  |
| `src/connection/platform.ts` — `clientMetadata()`                     | client label                                                                                      | Only the presentation label of the connecting client (shows in T3's session list). Cosmetic, but this is where the hosted client's identity string lives.                                                                                                                      |

### Shared client runtime (`packages/client-runtime`)

| Seam                     | Change                                               | Why there                                                                                                                                                                                                      |
| ------------------------ | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json` `exports` | add `"./zerops"`                                     | The package has an explicit exports map; a new module is invisible to web/mobile until it is listed.                                                                                                           |
| `src/zerops/` (new)      | Zerops API client + credential/selection persistence | Shared by web and mobile so both clients use **one** Zerops auth model (the POC first had two — `hacks.md` H-04). Plain `async/await`, no Effect runtime: it talks to the Zerops REST API, not to a z3 server. |

### Mobile (`apps/mobile`)

| Seam                                                                          | Change                                                                                                                                                          | Why there                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/App.tsx`                                                                 | `ZeropsAuthProvider` wrapped **around** `CloudAuthProvider`                                                                                                     | Same reason as web's AppRoot: Zerops identity is independent of T3's cloud auth; it has to be available to the cloud/link layer, so it sits outside it.                                                                                                                                              |
| `src/Stack.tsx` + `features/settings/components/settings-sheet-targets.ts`    | two settings screens (`zerops/account`, `zerops/projects`)                                                                                                      | Native stack routes are declared in one navigator with `linking` paths; the settings sheet has a closed target union — both must list a new screen.                                                                                                                                                  |
| `features/settings/SettingsRouteScreen.tsx`                                   | a "Zerops" section (account + projects rows) in both the local and the configured variants                                                                      | The settings screen renders two independent trees (local vs configured); a section must be added to each.                                                                                                                                                                                            |
| `app.config.ts`                                                               | personal-team iOS builds: `T3CODE_IOS_PERSONAL_TEAM_ID`, `updates.enabled=false` for personal-team builds, the capability-stripping plugin registered **first** | Functional, not branding: without a paid team you cannot sign app groups / Sign in with Apple / push entitlements; Expo config plugins run entitlement mods in reverse registration order, so the stripper must be registered first. Full recipe: `git show poc-2026-08-28:docs/ios-build-brief.md`. |
| `lib/authClientMetadata.ts`, `features/agent-awareness/remoteRegistration.ts` | client label / Live Activity title                                                                                                                              | Presentation strings only.                                                                                                                                                                                                                                                                           |

### Desktop (`apps/desktop`)

| Seam                                              | Change   | Why there                                                                        |
| ------------------------------------------------- | -------- | -------------------------------------------------------------------------------- |
| `src/app/DesktopEnvironment.ts` — `APP_BASE_NAME` | app name | Cosmetic; listed so nobody looks for a deeper desktop seam — the POC found none. |

### Server (`apps/server`)

The POC changed **nothing** in the server. Everything server-side (mint, sidecar, healthz) was
done in zcp's nginx + a Go sidecar (`../zcp` branch `feat/z3-container`), which is exactly what
D1/D2 replace. `scripts/cli.ts pack` (2026-08-28) is the one server-side addition and is carried.

---

## Functional facts from the Zerops modules

Code at `git show poc-2026-08-28:<path>`; facts that were live-verified carry a `verified.md`
pointer.

**Zerops API from the browser** (`packages/client-runtime/src/zerops/api.ts`, 600 lines + tests)

- The API answers cross-origin with `Access-Control-Allow-Origin: *` — no proxy is needed
  (`verified.md`, "Zerops API from a browser").
- Login / TOTP / recovery / refresh mirror `frontend-legacy`'s flow; the client accepts either a
  full session or a bare token (`ZeropsCredential`).
- **The org comes from `/user/info` → `clientUserList`**, and an account can belong to several
  orgs — read every org, not the first (`poc(zerops): resolve the org from clientUserList, and
read every org`). Membership is what S0.1 / S1 build on.
- **Region is parsed from the project's `publicZone`** (`"…prg1-zerops.zone"` → `prg1`), which
  both clients already fetch — never hard-code `prg1`, never fetch `zeropsSubdomain` for it
  (`hacks.md` H-01). `buildZeropsContainerUrl(…, region)` derives the container origin.
- Service grouping for a project overview: `runtimes | data | infrastructure`, decided from the
  service type (`categorizeZeropsService`). S6's service map starts from this taxonomy.

**Finding the zcp container** (`apps/web/src/zerops/candidates.ts`)

- **A zcp container is identified by its service _type_, not by hostname** — a project can have
  several, and `zcp` is only the default name. Candidates are derived per project across every
  org into `connected | ready | unavailable`; a `ready` candidate without a z3 origin means the
  container exists but z3 is not reachable yet. The pure derivation is separated from the
  fetching shell (concurrency-capped, incremental re-render) — keep that split in S4.
- "Already connected" is decided by matching the derived z3 origin against T3's registered
  environments (`displayUrl`, origin-normalised).

**Connecting** (`apps/web/src/components/zerops/connect.ts`) — replaced by D1, two facts survive

- A container health probe is needed before pairing: `ready | initializing | broken | unknown`
  from `/healthz` (`hacks.md` H-07). D2 keeps `/healthz`.
- Requests to the container origin must be **plain, header-less GETs** with `redirect: "manual"`
  — any custom header forces a CORS preflight the container's nginx does not answer. Relevant to
  S1/S2 when the client talks to `/z3/` on the 8080 origin.

**Mounts** (`apps/web/src/components/zerops/mounts/`) — replaced by S6's topology feed

- T3 already has a filesystem-browse RPC; the POC joined its `/var/www` directory listing to the
  project's services to show "mounted" rows. It could not tell a live mount from a stale
  directory (`hacks.md` H-08, H-21) — the topology feed must carry mount state from zcp itself.

**Session persistence** (`packages/client-runtime/src/zerops/session.ts`)

- One storage-adapter interface (`get/set/remove`, async) satisfied by both `localStorage`
  (web) and secure storage (mobile); credential and project selection stored separately under
  versioned keys. D1 needs the same shape for the Zerops token — reuse the idea, not the code.

---

## What the POC did NOT find out

Still open after the POC; each was measured afterwards and lives in `verified.md` (the S0 section,
2026-08-28) or `questions.md`:
membership proof endpoint (S0.1), restart = upgrade (S0.2), git cost over sshfs vs ssh
(S0.3/S0.4, `questions.md` Q-05), base path under nginx (S0.5), registration API (S0.7),
two clients on one container (S0.9, Q-07), history durability (S0.10), envelope extraction
(S0.12).
