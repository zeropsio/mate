# Hosted web scenarios

Run from the repository root:

```sh
vp test run --config apps/web/test/scenarios/vitest.config.ts
```

For chat/provider ports, run the named two-boundary gate from the root:

```sh
node scripts/chat-gate.ts
```

It runs all provider SPI goldens (A), every C client wire journey (B), and wire-consumer plus
scenario typechecks concurrently, reporting their results and durations separately. `--list`
shows its commands. `scripts/gate-changed.ts` and CI use the same selector, including server-only
provider, SPI and orchestration changes. The C driver tests remain implementation tests; they
cannot substitute for B. No expected-failure case belongs in C. Provider goldens compare canonical
SPI output, while C uses reported wire facts and proves client behavior, not real provider/git
execution. Desktop shares this web surface; native mobile remains outside this gate.

The independent `scenarios` and `scenario-drivers` Vitest projects are separate from `unit`.
The hosted production bundle is cached at `node_modules/.cache/mate-scenario-web/<input hash>`
within this worktree. Git discovers tracked and new non-ignored source files, including Tailwind's
`design*.html` inputs. Ignored build environment files and the public build environment also join
the key. This conservative source set can invalidate on unrelated edits; vendored reference
repositories and generated routes are excluded. Concurrent runs await the builder, failed builds
never publish, and unchanged invocations reuse the bundle.
Each run launches headless Chrome and starts real HQ Core with isolated databases on the
[shared host test PostgreSQL](../../../../docs/internals/test-postgres.md) and disposable git roots
through `apps/hq/test/harness`. Nothing imports application modules into the browser or replaces
its stores. This lives in `apps/web/test` because the observable subject is the hosted web client;
Core's established test infrastructure remains reusable by its own tests.

Prerequisites: workspace dependencies, installed Chrome, `flock` and local Postgres binaries. Override
Chrome with `MATE_CHROME_BIN` and Postgres with `MATE_PG_BIN`. Puppeteer Core never downloads Chrome.
Use `pnpm install --offline` when dependencies are absent and the package cache is populated.
HTTP and WebSockets are routed to loopback only; Chrome background networking and external DNS
are disabled. Both unmapped HTTP and WebSocket destinations fail the suite, even if the app catches
an error. Uncaught page errors and unmapped network diagnostics survive browser closure and fail
an `afterAll` file-level assertion, including inside `it.fails` / `it.effect.fails`. Vitest also
inverts failing `afterEach` hooks in expected-failure tests, so they cannot enforce this guard.
Only browsers actually opened by selected tests contribute diagnostics; `-t` filters are safe.

## Layout

- `harness/{build,http,browser}.ts`: production build, loopback servers, pages/contexts and routing.
- `harness/scenario.ts`: real Core composition and the foundation `given / when / then` DSL.
- `harness/clientClock.ts`: opt-in browser timers, stepped network settling and lifecycle controls.
- `harness/completedHttp.ts`: request-body completion and renderer-turn receipts for clock settling.
- `harness/hqCore.ts`: production-like Core timing defaults and per-scenario overrides.
- `apps/hq/test/harness/core.ts`: real Core with injectable timing overrides.
- `fakes/zerops.ts`: REST, socket login, subscriptions, versioned entity tables, faults and budgets.
- `fakes/zeropsWrites.ts`: shared HTTP deployment/import driver and process transitions.
- `fakes/zeropsWorld.ts`: organization memberships, person presets and project grants.
- `fakes/mate.ts`: contract-checked environment, door/OAuth, RPC, snapshots and sequence replay.
- `fakes/hqConnection.ts`: interruptible, endpoint-agnostic proxy to real Core.
- `areas/foundation/examples.scenario.ts`: B (Zerops-only discovery and HQ path), C and G.
- `areas/harness/extensions.scenario.ts`: reusable apps, tiers, identities, tabs and contexts proof.
- `fakes/**/*.test.ts`: focused wire/HTTP/clock/proxy tests.

## Exact extension recipe for A–H jobs

Each job owns `areas/<area>/` and optionally `fakes/<area>/`; no shared registration file changes:

1. Add `areas/<area>/<name>.scenario.ts`. The existing glob discovers it. Use
   `it.layer(tempPostgresLayer, { excludeTestServices: true })` as the examples do.
2. Export a `ScenarioExtension` from `areas/<area>/fake.ts`; call
   `yield* createScenario([installArea])`. Install before creating fixtures or signing in.
3. Add HTTP endpoints with `drivers.zerops.handlers.push(handler)`; return `undefined` when an
   endpoint belongs to another driver. Add any entity kind with `zerops.put(kind, fullRow)` or
   remove it with `zerops.remove(kind, id)`. Full rows get increasing `_version`; registrations
   match arbitrary fields, including organization-wide `clientId`. Use `entity-first` or
   `membership-first` delivery explicitly. Drivers contain all endpoint/frame knowledge.
4. Extend Mate RPCs with `drivers.onMate.push(mate => mate.rpcHandlers.push(handler))`.
   Decode/encode using contracts/shared; reply with `mate.reply` or `mate.chunk`. Add localhost
   servers to `drivers.routes` and their close functions to `drivers.cleanup`. Call
   `scenario.web.setRoutes()` after changing routes on already open pages.
5. Add area domain helpers in `areas/<area>/dsl.ts` around the returned scenario. Never put
   endpoint/frame knowledge in scenarios. Select roles, visible text or existing
   `data-zerops-surface` attributes. Wait on conditions/receipts with deadlines; never sleep.
6. Add driver tests under `fakes/<area>/*.test.ts`, discovered automatically. Include each
   scenario's one-line bug comment and prove it once with a temporary fake/input mutation.

Public fixture and control APIs (all scoped to one scenario). Project fixture names also serve as
synthetic ids: use URL-safe names. Environment names follow Core's lowercase naming rules:

```ts
const s = yield * createScenario([installArea]); // existing calls remain valid
// Optional second argument; all values are milliseconds, scoped to this scenario:
// createScenario([installArea], { hq: { pingEvery: 20_000, reconcileEvery: 60_000, streamRecheck: 30_000 } });
// A running deploy is refused after ~10 s of REAL Core time; poll every 250 ms:
// createScenario([installArea], { hq: { followFor: 10_000, pollEvery: 250 } });
yield * s.given.app("Shop"); // idempotent, also created automatically by given.project
for (const name of ["Ada", "Bea"]) yield * s.given.project(name, { mate: true, app: "Shop" });
yield * s.given.project("Shop-stage", { app: "Shop", kind: "stage", environmentName: "stage" });
yield * s.given.project("Shop-live", { app: "Shop", kind: "production", environmentName: "live" });
yield * s.given.project("Cara", { mate: true, app: "Other" });
// owner is the real Core setup session; appIds maps names to real Core ids.
const { owner, appIds } = s.drivers; // also s.owner / s.appIds

s.given.person("colleague", { role: "Developer", grants: { Ada: "BASIC_USER" } });
// Developer is the real preset: NO_ACCESS + canCreateProjects: true, with optional project grants.
// All ZeropsOrgRole values are accepted; canCreateProjects and status can be overridden.
s.given.person("reader", { role: "READ_ONLY", canCreateProjects: false });
// Memberships are per organization; adding another preserves the person's existing memberships.
s.drivers.zerops.world.organizations.set("OTHER", {
  name: "Second",
  settings: { locationList: [] },
});
s.given.person("colleague", { orgId: "OTHER", role: "READ_ONLY" });
// Put platform-only inventory from an area driver; clientId scopes it to that organization.
s.drivers.zerops.put("project", { id: "Dora", name: "Dora", clientId: "OTHER" });
s.given.asPerson("colleague"); // choose BEFORE sign-in; defaults: owner, dev, reader
// This is the real authorize-app hand-over, including nonce + production callback.
yield * s.given.signedIn;
const reader = yield * s.given.browserActor({ person: "reader" }); // new isolated context
const otherTab =
  yield * s.given.browserActor({ person: "reader", context: reader.page.browserContext() });
yield * Effect.promise(() => reader.clock.install()); // BEFORE its first navigation
yield * reader.given.signedIn;
yield * otherTab.given.signedIn; // shares the real account session; another person requires new context
// An actor has its own given/when/then/page/clock. web.newContext/newPage are also public.

// Then sign in and drive conditions; advance actual browser positive timer waits explicitly.
yield * Effect.promise(() => reader.clock.advanceStepped(30_000));
// Existing advance(ms, coalesce?) still performs a bulk advance with microtask draining only.
yield * Effect.promise(() => reader.clock.sleep());
yield * Effect.promise(() => reader.clock.wake(3_600_000));
```

`world.organizations` maps ids to `{name, settings?}`; `world.members` contains per-organization
memberships. `given.person(name, {orgId?, role?, canCreateProjects?, status?, grants?})` updates one
membership without replacing other organizations. Grants override the organization role and are
keyed by project id. `definePerson(world, name, options)` and `projectRoles(world, projectId, orgId?)`
from `fakes/zeropsWorld.ts` expose the same APIs to independent area drivers (including future
project grants). `/user/info` lists every membership; client settings, members, projects and
integration tokens are scoped to the requested organization. Personal credentials can span
organizations; integration credentials remain scoped to their own organization.
`when.zerops.colleague.createsProject` mutates the world directly and returns without waiting for
client subscriptions. Area scenarios assert visible outcomes in `then`.

`advanceStepped(ms, {settle?, timeout?})` fires one due timer at a time and awaits completed HTTP
requests before choosing the next timer (including timers newly scheduled by response handlers).
The default tracks `requestfinished` / `requestfailed`, then observes renderer turns for response
continuations and any HTTP they start. The whole condition has a 10-second deadline, overridden by
`timeout`; it uses no quiet-time delay. Puppeteer's `waitForNetworkIdle` counts responses complete
at headers, so it cannot guard body readers or response-driven retries. For held fake replies,
deliberate timeouts, or WebSocket-driven work, supply `settle: async () => { ... }` to replace that condition. The area driver must release
any held response and await its reply/UI receipt before returning; use deadlines. For example:

```ts
const settledHttp = completedHttp(actor.page); // import harness/completedHttp.ts; register before navigation
await actor.clock.advanceStepped(7_000, {
  settle: async () => {
    await area.releaseAdmittedReplies(); // domain driver, no protocol in the scenario
    await settledHttp();
    await area.repliesApplied(); // add a semantic condition when HTTP completion is insufficient
  },
});
```

WebSockets are long-lived and excluded from HTTP idle; the custom settler owns their receipts.
A held HTTP request whose completion needs a later virtual timeout requires a custom settler;
the default intentionally stops at that request instead of overtaking it. Install before
navigation, await initial fixture/UI conditions, then advance. `advance(ms)` executes
positive timers in deadline order, including chained backoff/Retry-After waits, and drains their
microtasks. Zero-delay scheduler jobs and requestAnimationFrame stay native so React and condition
waits keep running. `sleep()` freezes the renderer through CDP; `wake(elapsedMs)` resumes, advances
Date, coalesces overdue timers, and emits online/pageshow signals. This is a renderer sleep model,
not a full OS suspend: performance.now, network services and real HQ clocks remain native. Await
fake receipts/UI conditions before the next clock advance; advancing is not a network drain.
Scenario Core now uses production-like ping/reconcile/stream-recheck intervals of 20/60/30 seconds.
Override them with `createScenario(extensions, {hq: {pingEvery?, reconcileEvery?, streamRecheck?}})`;
values are milliseconds. `startCore` accepts corresponding Effect Duration overrides, retaining
its old 300/200/200 ms defaults for existing HQ unit tests. Page clocks do not advance Core time.
`followFor` and `pollEvery` similarly pass from `createScenario` through `startScenarioCore` into
`startCore`, which accepts Effect Durations. Omitting either preserves that Deploys default
(75 minutes / 10 seconds). The production Core's injectable deploy options provide these overrides;
scenario tests use the same service graph, routes and production drain.
G exercises real client reconnect timers with this clock. Core's own 10-second HTTP timeout is
native; it is not sped up by the page clock. For time-sensitive areas this split is the least
intrusive seam: no application hooks, fake responses or altered backoff implementation.

Faults: `zerops.faults.set("GET /project/Ada", { status: 429, retryAfter: 7 })`, optionally `code`,
`message`, `latency`, `timeout` or `silence`. Use `<kind>:push` + `silence` for realtime loss.
`zerops.clock.advance(ms)` releases fake latency and expires socket credentials; it is separate
from each page's clock. Process/version timestamps use `zerops.clock.currentTimeMillis()`: native
wall time by default, or a pinned epoch via `zerops.clock.setTime(epochMilliseconds)` followed by
`clock.advance(ms)`. Installing an actor's page clock pins the fake wall clock to that actor and
synchronizes it before every timer callback (including stepped advances and wake). Therefore a
page-triggered write is stamped at the callback's virtual deadline, while latency/socket expiry
remain independent. If several actor clocks are installed, the most recently driven actor controls
the shared world's wall time; advance them coherently when comparing timestamps across tabs.
Await `zerops.waitForRequest(key, count)` before releasing pending latency.
Counters: `requests` (method/path), `requestsByKind`, `requestsByCredential` (credential → method/path
map), `registrations` and `framesByKind` (kind:output). Core's platform requests use these SAME
HTTP counters; `core.fake.calls` is only meaningful with the default HQ in-memory test backend.

`scenario.hq.ready()` waits on any upstream HTTP response or WebSocket open + first frame;
`drops()` cuts every HQ link/request and `returns()` restores forwarding. Proxy counters are
`httpRequests`, `httpUpBytes`, `httpDownBytes`, `wsOpens`, `wsUpFrames`, `wsDownFrames`, `wsUpBytes`
and `wsDownBytes` (payload bytes, not transport framing/headers). Outage assertions belong in
`then.hq.isUnavailable`; `when` only drives actions. `then.noReload` compares document time origins.

## Fidelity and known gaps

Core is real and uses `makeZeropsApiHttp`, `makeZeropsDeployHttp`, and `makeZeropsObservationHttp`
against the fake origin. `startCore(..., { zeropsHttp: { baseUrl, world } })` opts in; existing HQ
tests retain their default in-memory adapters. Both browser and Core writes use the same world and
versioned realtime tables. Deploy/import/subdomain jobs emit processes with project/action and
timestamps; `zerops.writes.autoComplete = false` and `writes.transition(id, status, message?)` allow
area drivers to control them. The default completes jobs at the first process/version read, as
the existing HQ fake did. Domain `CANCELLED` maps to Zerops's measured wire spelling `CANCELED`.

Measured revoked/gone error bodies are `{error:{code,message,meta}}`; a gone project is 400
`projectNotFound`, a revoked token 401 `notAuthorized`. Search includes limit/offset/totalHits and
slices items; sorting and unsupported operators are not modeled (unsupported operators fail).
Login accepts a JSON API token without a Bearer header, mints distinct short-lived socket tokens,
and rejects API tokens at the socket. Current-state reads can register before socket setup;
pre-bind pushes are delivered in their original order on the receiver's first bind. Subsequent
pushes resolve the receiver's current socket. Close removes only that socket's subscriptions.
There is no reconnect replay: current state comes only from a fresh registration response. ACLs model org roles and
project grants, not the entire production platform. Schema validation, region routing, deployment
YAML/build execution, all native process fields and signed-log storage are approximated.

The fake app.zerops.io approves the selected synthetic account and returns through the real
`/zerops/authorized` entry point; no session/storage seeding. Mate uses typed wire snapshots and
`afterSequence` replay but does not execute providers, git or filesystem operations. OAuth/door
signatures, DPoP and expiry enforcement are synthetic. Real Core overview links are enrolled;
use `drivers.links.get(name)` to send further contract-typed `MateLinkUp` overviews in an area driver.
No real credentials/live databases are read. Desktop/mobile behavior is outside this hosted suite.

B's Zerops-only discovery case is an ordinary scenario: a colleague's project appears within
five seconds without HQ enrollment or reload. The separate HQ enrollment example protects its
own path; both remain useful witnesses.
