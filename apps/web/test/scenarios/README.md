# Hosted web scenarios

Run from the repository root:

```sh
vp test run --config apps/web/test/scenarios/vitest.config.ts
```

This standalone config runs `scenarios` and `scenario-drivers`; it is separate from `unit` and
is not registered with CI. It builds the actual hosted production web bundle once in a temporary
directory, launches fresh headless Chrome profiles, and starts real HQ Core with disposable
Postgres databases and git roots through `apps/hq/test/harness`. No application module is imported
into the browser or mocked. Only contracts/shared wire codecs are used by Mate drivers.

Prerequisites: workspace dependencies, installed Chrome, and local Postgres binaries (the existing
HQ harness finds Homebrew Postgres on macOS). Override Chrome with `MATE_CHROME_BIN` and Postgres
with `MATE_PG_BIN`. Puppeteer Core never downloads a browser. For an already populated package
cache, `pnpm install --offline` avoids registry access.

## Layout and extension recipe

- `harness/build.ts`, `http.ts`, `browser.ts`: build, loopback servers, network routing, Chrome.
- `harness/scenario.ts`: composition and the foundation's domain `given / when / then` DSL.
- `fakes/zerops.ts`: platform HTTP, realtime entities, membership, manual clock, faults and budgets.
- `fakes/mate.ts`: contract-checked environment, door/OAuth, RPC, snapshots and sequence replay.
- `fakes/hqConnection.ts`: interruptible transport to real Core; no HQ response is invented.
- `areas/foundation/examples.scenario.ts`: B, C and G examples.

Each A–H job owns `areas/<area>/`:

1. Create `areas/<area>/<area>.scenario.ts`. The existing glob discovers it automatically. Use
   `it.layer(tempPostgresLayer, { excludeTestServices: true })` as the examples do.
2. Create `areas/<area>/fake.ts` exporting a `ScenarioExtension`. Install it with
   `yield* createScenario([installArea])`. No shared registry or config edit is needed.
3. Extend `drivers.zerops.handlers` for additional HTTP endpoints and `drivers.zerops.put(kind, row)`
   for new entity kinds. Filters are matched over row fields rather than a catalog of registrations.
   Set `faults` by `METHOD /path`, or `<kind>:push` with `silence`. Advance `clock` explicitly for
   configured latency. Counters are `requestsByKind`, `registrations` (`kind:output`) and
   `framesByKind`; real Core's injected API calls remain in `drivers.core.fake.calls`.
4. Use `drivers.onMate.push(mate => mate.rpcHandlers.push(handler))` to handle a new contract RPC on
   every subsequently created Mate. A handler returns true when it owns the request. Validate its
   payload/results using contracts; send with `mate.reply` / `mate.chunk`. `mate.handle` can also be
   wrapped by an area driver. Additional localhost servers register their production origin in
   `drivers.routes` and their close function in `drivers.cleanup` before `given.signedIn`.
5. Put additional domain DSL helpers in `areas/<area>/dsl.ts`, composed around `createScenario`.
   Keep endpoint, frame and identifier knowledge in your fake/driver module, never in a scenario.
   Select only accessible roles, visible text and existing `data-zerops-surface` attributes.
   Wait for observable conditions or driver receipts with bounded timeouts; never sleep.
6. Add the one-line bug comment. Put focused fake tests in `fakes/<area>/*.test.ts`; the existing
   `scenario-drivers` glob discovers them automatically. This directory is owned by your area too.

Cleanup is scoped to each scenario. Database state is disposable; nothing reads the maintainer's
live Mate state, account files or credentials. Desktop and mobile are intentionally outside this
hosted-web harness; no shared client behavior changes here.

## Boundaries

The real hand-over button navigates to the fake `app.zerops.io/authorize-app`, which immediately
approves a synthetic personal credential and returns the actual nonce to `/zerops/authorized`.
The production callback handles the return normally; no storage/session seeding occurs. Mate door
exchanges and HQ sessions then run over their real client paths. HTTP requests to production-shaped
origins are fulfilled through localhost counterparts; a native-WebSocket subclass changes only the
transport address to localhost. Unknown network destinations are blocked and asserted absent.
Chrome background networking is disabled and external DNS resolution is disabled.

Fake Zerops reuses Core's `FakeWorld`; HQ runs with the existing harness's injected platform API,
not through the browser-facing REST server. Project/member/token state is shared. HQ deploy behavior
is the existing harness's model; new areas must synchronize native REST entities and realtime
pushes with those operations explicitly. Platform authorization is token presence plus configured
faults, not Zerops's full ACL implementation. Search operators are field-driven (`eq`, `ne`, `in`,
`nin`/`notIn`, comparisons, `contains`); unsupported operators fail visibly. Search pagination and
sorting are not yet modeled. Reconnect forgets all registrations; fresh registration answers the
current state and never replays missed events.

Mate preserves the current typed snapshots, events, receipts and `afterSequence` replay, but does
not execute providers, git or filesystem work. Its OAuth/door credentials are synthetic; signature,
DPoP, expiration and authorization enforcement are not modeled. Area modules supply those failures
when needed. HQ overview fixtures use a real enrolled Mate link. The base fixture sends one full
overview; areas modeling work use `drivers.links.get(name)` to send further typed `MateLinkUp`
overviews through that real link in their area driver.

## Foundation B limitation and requested app seam

The green B example creates a Mate-backed project, pushes its Zerops rows, and enrolls its Mate in
real HQ (`enroll: true`). Today, projects without a Mate live in the Projects screen rather than
the left menu. A newly pushed project without HQ enrollment also fails to enter the inventory:
Chrome receives both membership and full-row frames and fetches `/project/Bea`, but no service
inventory demand for Bea follows and the menu/Projects count stays unchanged. Removing `enroll: true`
from B reproduces that failure. Request: confirm/establish access and inventory demand when a new
organization membership arrives, so a Zerops-only addition can become visible without reload.
No selector addition or application code change was made. The B area should carry that case as an
explicit known failure until it is fixed; the green example covers today's full creation path.
