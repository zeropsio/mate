# Remote Architecture

> For maintainers. Using Zerops Mate? See [docs/user](../user/).

The released web client reaches a Mate only through a Zerops account: a person signs in, the
organization's HQ stands in front of the product (ADR 0001: HQ is mandatory, with no mode without
it), and each Mate is entered through its identity door with a throwaway token. There is no
standalone server, pairing code or manually entered endpoint in the product: the retired `/pair`
bookmark discards its credential and redirects to `/zerops` (`apps/web/src/routes/pair.tsx`).
Shared client source still retains upstream's other connection target shapes and its pairing
helpers, which the web client never offers (mobile keeps a dormant native pairing screen, below),
and this fork publishes no client that provisions SSH
tunnels. For the user-facing guide see [your Zerops account](../user/zerops-account.md).

## The model

T3 has one runtime boundary: a client talks to a T3 server over HTTP and WebSocket, and the server
owns orchestration, providers, terminals, git, and filesystem operations. Remoteness is expressed at
the connection layer, never by splitting the runtime.

```text
┌──────────────────────────────────────────────┐
│ Client (desktop / mobile / web)              │
│  known environments, connection supervisor   │
└───────────────┬──────────────────────────────┘
                │ resolves one access endpoint
┌───────────────▼──────────────────────────────┐
│ Access method                                │
│  direct authenticated HTTP and WebSocket     │
└───────────────┬──────────────────────────────┘
                │ connects to one T3 server
┌───────────────▼──────────────────────────────┐
│ Execution environment = one T3 server        │
│  identity, providers, projects/threads,      │
│  terminals, git, filesystem                  │
└──────────────────────────────────────────────┘
```

### ExecutionEnvironment

One running T3 server instance. It owns provider availability and auth, model availability, projects
and threads, terminal processes, filesystem access, git operations, and server settings.

It is identified by a stable `environmentId`, persisted by the server at `<stateDir>/environment-id`
and generated on first start (`apps/server/src/environment/ServerEnvironment.ts`). Desktop, mobile,
and web all reason about the same concept.

### Known environments and connection targets

A saved client-side entry for an environment the client knows how to reach. It is not
server-authored; it is local to a device or client profile. In the hosted web app these entries are
browser-local, and only a Mate's identity door creates one; the hosted app keeps no server-side
control plane or copy of session state.

[`connection/model.ts`][model] defines four target tags, which are the real access taxonomy:

| Target                    | Used for                                                                     |
| ------------------------- | ---------------------------------------------------------------------------- |
| `PrimaryConnectionTarget` | The environment selected by the current platform.                            |
| `BearerConnectionTarget`  | A Mate entered through its identity door, over direct HTTP/WebSocket.        |
| `RelayConnectionTarget`   | Persisted compatibility records; relay resolution is unsupported.            |
| `SshConnectionTarget`     | Persisted compatibility records; the released web client has no SSH gateway. |

Bearer and SSH are persisted; primary is platform-managed. A Mate's bearer registration comes from
its door's exchange in [`onboarding.ts`][onboarding]. The upstream pairing path beside it
(`preparePairingRegistration`, a pairing URL or a host plus pairing code) is never called by the
web client; mobile still reaches it through its native pairing screen (`ConnectionsPairing`,
`connectPairingUrl`), kept as dormant source (`mobile-zerops-integration-source.test.ts`).

### AdvertisedEndpoint

A server- or desktop-authored candidate endpoint for an environment: a concrete HTTP and WebSocket
base URL pair, a default/available/unavailable marker, reachability hints (loopback, LAN, private,
public, tunnel), and compatibility hints such as whether the hosted HTTPS app can use it.

Clients treat advertised endpoints as hints, not proof that a route works from the current device.
The connection attempt decides.

The released web client shows no endpoint to pair with: the connections settings point to the Zerops
projects (`ConnectionsSettings.tsx`), and a Mate's address comes from its Zerops project.

### Endpoint providers

Endpoint providers contribute advertised endpoints without becoming part of the core environment
model: core owns environments, pairing, and connection lifecycle, and providers return normalized
`AdvertisedEndpoint` records. No third-party provider is built in today — see Future work.

### Hosted pairing request (retained source, not a product entry)

Upstream's hosted pairing request is a bootstrap URL for the static web app, not a transport. The
released web app no longer honours it — `/pair` redirects to `/zerops` without exchanging the token —
and the helpers below remain in source only:

```text
https://app.t3.codes/pair?host=https://backend.example.com:3773#token=PAIRCODE
```

The hosted app reads `host`, takes the token from the URL hash, exchanges it directly with that
backend, strips the token from browser history, and saves the environment record locally. Helpers
live in [`shared/remote.ts`](../../packages/shared/src/remote.ts) (`setPairingTokenOnUrl`,
`getPairingTokenFromUrl`, `stripPairingTokenFromUrl`) and `apps/web/src/hostedPairing.ts`.

Constraints:

- the hosted app does not proxy HTTP or WebSocket traffic;
- the backend must be directly reachable from the browser;
- HTTPS pages can only reach HTTPS/WSS backends;
- HTTP LAN endpoints keep using direct desktop or CLI pairing URLs;
- the token belongs in the hash so it is never sent to the hosted app origin.

### RepositoryIdentity and Project

`RepositoryIdentity` is a best-effort logical repo grouping across environments, used for UI grouping
and correlation only, never for routing. `Project` remains environment-local: a local clone and a
remote clone are different projects that may share a `RepositoryIdentity`, and threads bind to one
project in one environment. The canonical key follows the `upstream` remote when
one exists, so pull request features target the repository a fork tracks. A fork also reports its
own `origin`, and clients group and label by that, so a fork never collapses into a checkout of its
upstream.

## Access methods

Access answers one question: how does the client speak WebSocket to a T3 server? It does not answer
how the server got started or who manages the process.

### Direct WebSocket access

`wss://t3.example.com` or `ws://10.0.0.15:3773`, reached as a bearer target. This is the base model.
It works for desktop, mobile, and web with no client-side process management. Browser security rules
are part of it: a hosted HTTPS client cannot connect to plain `ws://` or `http://` LAN backends.

### Retained SSH target shape

The shared runtime retains `SshConnectionTarget` and the `SshEnvironmentGateway` capability so
client surfaces can decode persisted profiles without changing the connection model. The broker in
[`connection/resolver.ts`][resolver] delegates preparation through that capability. The released web
client supplies an unsupported gateway, so it neither launches a remote server nor opens a tunnel.
The deleted desktop SSH implementation has no live documentation link.

## Launch methods

Launch answers a different question: how does a T3 server come to exist on the target machine? Keep
it separate from access.

- **Zerops environment.** zcp installs and supervises the Mate server release in the project
  container. It is the only launch the product serves; a standalone `mate serve` outside a Zerops
  project has no entry in the released web client.

## Security model

Some environments are reachable over untrusted networks, so remote-capable environments require
explicit authentication, tunnel exposure never relies on obscurity, and saved endpoints carry enough
auth metadata to reconnect safely.

WebSocket authentication is a dedicated short-lived ticket, not a token in a query string. The client
presents its long-lived bearer or DPoP credential in HTTP headers to
`POST /api/auth/websocket-ticket` ([authorization/remote.ts][authremote]), and appends only the
returned ticket as `wsTicket` on the socket URL. The server issues it through
`EnvironmentAuth.issueWebSocketTicket`; tickets are tagged `kind: "websocket"` and default to a
five-minute TTL (`DEFAULT_WEBSOCKET_TOKEN_TTL` in `apps/server/src/auth/SessionStore.ts`). The
handshake verifies the ticket, and each RPC method still enforces its own scope. See
[environment-auth.md](./environment-auth.md).

The hosted app takes no pairing token: a retired `/pair` link's token is dropped from the URL and
never exchanged. The hosted app stores no pairing state server-side and must not imply that an HTTP
backend is reachable from an HTTPS browser context.

## Version coordination

Remote environments stay online while clients move to newer releases. The environment descriptor
carries the running server version and may advertise a safe replacement path, so the UI can show the
right action without making the transport responsible for process management. The connection
supervisor owns the resulting disconnect and reconnect like any other involuntary close. See
[server-updates.md](./server-updates.md).

## Future work

These remain unbuilt and are listed to keep the model honest:

- third-party tunnel products as additional endpoint providers;
- richer multi-environment UI beyond the current connections list.

[model]: ../../packages/client-runtime/src/connection/model.ts
[onboarding]: ../../packages/client-runtime/src/connection/onboarding.ts
[authremote]: ../../packages/client-runtime/src/authorization/remote.ts
[resolver]: ../../packages/client-runtime/src/connection/resolver.ts
