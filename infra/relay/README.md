# T3 Connect Relay

The relay is the hosted control plane for T3 Connect. It helps clients discover and connect to
remote environments, manages the cloud-side records needed for those connections, and delivers
optional mobile notifications and Live Activities.

The relay is intentionally not in the hot path for normal T3 Code traffic. After a client connects,
regular API and WebSocket traffic goes directly between that client and the selected environment.

A plain Node service backed by direct Postgres — no Cloudflare, no Alchemy. Every environment it
links runs on Zerops and is reached over its own public HTTPS subdomain, so there is nothing left
for the relay to provision (no managed tunnels, no DNS records).

## Responsibilities

The relay currently owns:

- Linking Zerops-hosted T3 Code environments to a cloud account, verifying that the linking user is
  actually a member of the Zerops project the environment claims to run in.
- Issuing short-lived credentials used to authenticate published activity from a linked environment.
- Registering mobile notification preferences and APNs tokens.
- Receiving published agent activity and delivering notifications or Live Activity updates through a
  durable, Postgres-backed delivery queue.
- Persisting relay state.

The environment server and relay have separate credentials and trust boundaries: the environment
authenticates with a relay-issued credential minted at link time (never a Zerops token), and the
relay's own client-facing endpoints authenticate the _user_ with a Zerops access token.

## Code Map

- [`src/server.ts`](./src/server.ts) is the Node entry point: builds the HTTP server, the runtime
  service graph, and forks the background worker/pruner loop.
- [`src/http/Api.ts`](./src/http/Api.ts) contains the relay HTTP handlers and authentication
  boundaries.
- [`src/zerops`](./src/zerops) verifies Zerops access tokens (`ZeropsAuth`) and an environment's
  claimed project membership (`ZeropsProjectBinding`) against the Zerops REST API.
- [`src/environments`](./src/environments) contains environment linking and environment credentials.
- [`src/agentActivity`](./src/agentActivity) contains mobile device registration, activity state,
  APNs delivery, and the durable delivery queue (`ApnsDeliveryJobStore.ts` owns the job table;
  `ApnsDeliveryWorker.ts` is the lease/process loop and the pruner interval).
- [`src/auth`](./src/auth) contains relay token and DPoP proof handling.
- [`src/db.ts`](./src/db.ts) is the Postgres connection (`@effect/sql-pg` + Drizzle), built from
  `DATABASE_URL`.
- [`src/persistence/schema.ts`](./src/persistence/schema.ts) defines persisted relay state. Keep
  schema and migration changes together — `scripts/migrate.ts` applies
  `migrations/postgres/**` in order at startup (`pnpm run migrate`).

Shared request and response schemas live in
[`packages/contracts/src/relay.ts`](../../packages/contracts/src/relay.ts). Shared client-side relay
calls live in
[`packages/client-runtime/src/relay/managedRelay.ts`](../../packages/client-runtime/src/relay/managedRelay.ts) —
that client and `apps/server`'s server-side link handshake still target the pre-Zerops contract
shape as of this writing; reconciling them is a later slice.

## Working Locally

Install dependencies from the repository root, then run relay-focused checks from this directory:

```sh
vp install
cd infra/relay
vp test run
vp run typecheck
```

To run a smaller test set while iterating:

```sh
vp test run src/environments/EnvironmentLinker.test.ts
```

Before considering a change complete, run the repository-wide checks from the root:

```sh
vp check
vp run typecheck
```

Backend changes should include tests. Prefer testing the real business logic with external
dependencies represented at their boundary rather than mocking internal behavior — for the Zerops
API boundary specifically, inject a fake `HttpClient` (see `src/zerops/ZeropsAuth.test.ts` and
`src/zerops/ZeropsProjectBinding.test.ts`) rather than mocking `ZeropsAuth`/`ZeropsProjectBinding`
themselves.

### Running against a real Postgres

Copy [`infra/relay/.env.example`](./.env.example) to `infra/relay/.env` (or export the variables
directly) and point `DATABASE_URL` at a local or Zerops-hosted Postgres instance:

```sh
export DATABASE_URL=postgres://user:password@localhost:5432/t3code_relay
pnpm run migrate   # applies migrations/postgres/** in order
pnpm run dev       # node --watch src/server.ts
```

`GET /health` runs `SELECT 1` against the configured database.

## Config

All configuration is environment variables (`effect/Config` reads `process.env` directly — no
Alchemy stage/env-file indirection). See [`.env.example`](./.env.example) for the full list:
`DATABASE_URL`, `RELAY_ISSUER`, `HOST`/`PORT`, `CLOUD_MINT_PRIVATE_KEY`/`CLOUD_MINT_PUBLIC_KEY`,
`APNS_DELIVERY_JOB_SIGNING_SECRET`, `ZEROPS_API_HOST` (defaults to `api.app-prg1.zerops.io`), and
the `APNS_*` Apple Push credentials.

## Deployment

`zerops.yml` (build/run for the `relay` service) and `zerops-import.yml` (a standalone project
import: the `relay` Node service plus its own `db` PostgreSQL 16 single instance) describe the
target shape. Deploying is a lasting resource in the org and waits for the owner's go — these files
are not applied by CI in this slice. `initCommands` runs `pnpm run migrate` before the service
starts, so a fresh deploy provisions its schema automatically; `db` is given deploy priority so it
is reachable first.
