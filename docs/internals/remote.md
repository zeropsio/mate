# Remote Architecture

> For maintainers. Using Zerops Mate? See [docs/user](../user/).

The released hosted web client reaches Zerops environments directly through the identity door and
standalone environments through bearer pairing. Shared client source still retains other connection
target shapes for compatibility, but this fork does not publish a client that provisions SSH
tunnels. For the user-facing setup guide see [remote access](../user/remote-access.md).

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
browser-local. A hosted pairing URL can create one, but it does not give the hosted app a server-side
control plane or a copy of session state.

[`connection/model.ts`][model] defines four target tags, which are the real access taxonomy:

| Target                    | Used for                                                                     |
| ------------------------- | ---------------------------------------------------------------------------- |
| `PrimaryConnectionTarget` | The environment selected by the current platform.                            |
| `BearerConnectionTarget`  | Any manually paired endpoint reached over direct HTTP/WebSocket.             |
| `RelayConnectionTarget`   | Persisted compatibility records; relay resolution is unsupported.            |
| `SshConnectionTarget`     | Persisted compatibility records; the released web client has no SSH gateway. |

Bearer and SSH are persisted; primary is platform-managed. Any manually paired endpoint,
regardless of what private network it is reached over, is paired through the ordinary bearer path in
[`onboarding.ts`][onboarding] (`preparePairingRegistration`), which accepts either a pairing URL or a
host plus pairing code.

### AdvertisedEndpoint

A server- or desktop-authored candidate endpoint for an environment: a concrete HTTP and WebSocket
base URL pair, a default/available/unavailable marker, reachability hints (loopback, LAN, private,
public, tunnel), and compatibility hints such as whether the hosted HTTPS app can use it.

Clients treat advertised endpoints as hints, not proof that a route works from the current device.
The connection attempt decides.

The UI shows one default endpoint in the network-access summary and keeps the rest behind an advanced
list. `selectPairingEndpoint` in
[`ConnectionsSettings.tsx`](../../apps/web/src/components/settings/ConnectionsSettings.tsx) excludes
unavailable endpoints and then picks, in order:

1. the saved `defaultEndpointKey` override;
2. the first endpoint marked `isDefault`;
3. the first endpoint whose reachability is not `loopback`;
4. the first endpoint compatible with the hosted HTTPS app;
5. otherwise nothing.

There is no unconditional loopback fallback. A loopback endpoint only wins through an explicit saved
override or `isDefault`. Persist the override by stable endpoint kind rather than raw URL where
possible, since LAN addresses change with networks.

### Endpoint providers

Endpoint providers contribute advertised endpoints without becoming part of the core environment
model: core owns environments, pairing, and connection lifecycle, and providers return normalized
`AdvertisedEndpoint` records. No third-party provider is built in today — see Future work.

### Hosted pairing request

A hosted pairing request is a bootstrap URL for the static web app, not a transport:

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
project in one environment.

## Access methods

Access answers one question: how does the client speak WebSocket to a T3 server? It does not answer
how the server got started or who manages the process.

### Direct WebSocket access

`wss://t3.example.com` or `ws://10.0.0.15:3773`, paired as a bearer target. This is the base model.
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

- **Zerops environment.** zcp installs and supervises the pinned release in the project container.
- **Standalone server.** The operator installs a GitHub release tarball and starts `mate serve`; the
  client connects to that pre-existing server through its reachable endpoint.

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

Hosted pairing is a client-side convenience only. The hosted app must not receive pairing tokens
through query parameters, must not store pairing state server-side, and must not imply that an HTTP
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
