# The systems and the channels between them

## Systems

| #   | System           | Where it runs                                | Notes                                     |
| --- | ---------------- | -------------------------------------------- | ----------------------------------------- |
| 1   | mate client      | browser / desktop / phone                    | this repo, `apps/web` etc.                |
| 2   | mate server      | anywhere — for this work, inside (3)         | this repo, `apps/server`                  |
| 3   | `zcp` container  | one per Zerops project, service type `zcp@1` | nginx + code-server + agent CLIs + sshd   |
| 4   | Zerops API       | `api.app-prg1.zerops.io`                     | REST under `/api/rest/public`             |
| 5   | `zcli`           | the user's laptop                            | VPN, project ops, zcp SSH sessions        |
| 6   | sibling services | same project as (3)                          | reachable from (3) over the project VXLAN |

## Inside the zcp container

```
                    :8080  nginx ──── location /  ──► :8081  code-server  (serves /var/www)
  *.zerops.app ───►        (one location block, that is all)
                    :22    sshd  (user: zerops)
                    systemd units `zerops@<name>.service`, created via `zsc unit create`
                    /var/www/<hostname>  ← sshfs mount of each sibling service's /var/www
```

Two structural facts that shape everything else:

- **nginx has exactly one `location` block**, hardcoded to code-server. It is not a general front
  door — anything else needs its own declared port, or a template change.
- **`zcp init` is a `run.initCommands` boot step, so it re-runs on every container start** and
  re-renders nginx.conf from that template. Anything patched into nginx.conf at runtime is reverted
  by the next restart, so container-side changes belong in the template, never in a live edit.

## Where mate sits

`zcp@1` can declare as many ports as it needs, which makes the clean layout:

```
  :8080  ──► nginx ──► code-server          unchanged
             └──────► location = /z3-pair/<password>  ──► mints a pairing credential
  :3773  ──► mate server                      straight from the platform L7, no nginx in the path
```

- **mate gets its own declared port and its own origin**, so it needs no nginx block at all — the
  Zerops L7 terminates TLS and forwards to 3773 directly. See `questions.md` Q-09.
- **No cookie gate in front of mate.** A separate port is a separate origin with its own cookie jar,
  so `__zcp_auth` would not apply anyway, and mate's pairing → bearer → WS-ticket chain is real auth.
  Putting a second gate in front of it would add nothing and break the WebSocket.
- **The mint endpoint stays on 8080**, behind the password check that already exists there, because
  that is the only place with a cheap proof that the caller belongs to the project. It reuses the
  exact `/zcp-auth/{{.Password}}` path-token pattern rather than inventing new auth.

Resulting flow, with no VPN and no SSH anywhere in it: sign in to Zerops → read the zcp service's
`VSCODE_PASSWORD` through the authenticated API → call `/z3-pair/<password>` → pair to the 3773
origin → bearer and WS ticket from there.

## Channels

| From → To                | Carries                           | Auth                                | Needs VPN           | Verified                                     |
| ------------------------ | --------------------------------- | ----------------------------------- | ------------------- | -------------------------------------------- |
| client → Zerops API      | orgs, projects, services, env     | `Authorization: Bearer`             | no                  | yes — CORS is `*`                            |
| client → zcp public URL  | everything the container serves   | cookie `__zcp_auth`                 | no                  | yes — HTTP/2, ~86 ms, WS upgrade in template |
| client → mate server     | the actual work session           | pairing → bearer → WS ticket        | no                  | partially                                    |
| laptop → project VXLAN   | SSH, direct service ports         | WireGuard                           | **yes**             | yes                                          |
| zcp → siblings           | sshfs mounts, `zcli push` deploys | SSH keys, pre-trusted VXLAN-wide    | no (inside project) | yes                                          |
| agent in container → zcp | the `zerops_*` MCP tools          | none — stdio child process          | no                  | yes                                          |
| zcp → Zerops API         | what the MCP tools act on         | Bearer (`ZCP_API_KEY` / zcli token) | no                  | yes                                          |

**SSH over VPN is the only way to run a command inside a container from outside.** There is no API,
webhook, or network-reachable MCP endpoint. Anything else has to be built.

## The mate pairing chain

1. `GET /.well-known/t3/environment` — confirms it is a mate server, returns `environmentId` and label.
2. `POST /oauth/token` — RFC 8693 exchange, `subject_token` is the pairing credential, returns a
   30-day bearer.
3. `POST /api/auth/websocket-ticket` — with that bearer, returns a ~5-minute ticket.
4. `wss://…/ws?wsTicket=…`.

Client side this is all `packages/client-runtime/src/connection/onboarding.ts`. Server side the
credential is minted by `t3 auth pairing create --json` (`apps/server/src/cli/auth.ts`), which
needs no running server — it writes straight to the on-disk database under `--base-dir` — and is
the only scriptable path. `t3 pair` (`apps/server/src/cli/pair.ts`) is **not** it: that command
discovers an already-running server through its persisted `server-runtime.json` and prints a QR
code, and has no `--json` flag.

**The credential has to physically leave the container.** Today a human copies it out of a terminal.
Any automated path has to prove the caller is entitled to it — see `hacks.md` H-08.

## The Zerops VPN handshake

Plain REST, nothing about it is `zcli`-specific:

1. Generate a Curve25519 keypair locally.
2. `POST /project/{id}/vpn` with `{publicKey, instanceId?}`.
3. Response carries the project's WireGuard identity, the caller's assigned tunnel IP, **and
   pre-rendered config text per platform** (`setupMacOS`, `setupLinux`, `setupWindows`).

`zcli` then shells out to `wg-quick up <file>` — that step, and only that step, is what needs root.
A client that brings its own WireGuard data plane never needs `zcli` at all.

## Names once a tunnel is up

| Mode   | What resolves                                                      |
| ------ | ------------------------------------------------------------------ |
| single | `db`, `db.zerops`, and the shared `.zerops-project` domain         |
| multi  | only the exact `<service>.<projectInternalID>.zerops-project` form |

Multi mode installs one resolver per project and no shared search domain, so short names do not
work there. `zcpSession.NewTarget` in `zcli` already builds the correct long form — reuse it rather
than assembling host strings by hand.

## URL derivation

`https://{service}-{subdomainPrefix}-{port}.{region}.zerops.app`

`subdomainPrefix` comes from the project's `zeropsSubdomainHost`, which returns a **bare prefix**
with no domain, so it cannot supply the region. The region comes from the project's `publicZone`
(`fte23….prg1-zerops.zone` → `prg1`), which every project carries and which costs no extra request.
The service env `zeropsSubdomain` carries a whole ready-made URL too, but reading it means a
per-service `user-data` call, so it is the fallback rather than the default. H-01, the hardcoded
region, is paid back.
