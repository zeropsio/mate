# The systems and the channels between them

## Systems

| #   | System           | Where it runs                                | Notes                                      |
| --- | ---------------- | -------------------------------------------- | ------------------------------------------ |
| 1   | mate client      | browser / desktop / phone                    | this repo, `apps/web` etc.                 |
| 2   | mate server      | anywhere — for this work, inside (3)         | this repo, `apps/server`                   |
| 3   | `zcp` container  | one per Zerops project, service type `zcp@1` | nginx + code-server + mate + agents + sshd |
| 4   | Zerops API       | `api.app-prg1.zerops.io`                     | REST under `/api/rest/public`              |
| 5   | `zcli`           | the user's laptop                            | VPN, project ops, zcp SSH sessions         |
| 6   | sibling services | same project as (3)                          | reachable from (3) over the project VXLAN  |

## Inside the zcp container

```
                    :8080  nginx ──── location /      ──► :8081  code-server  (serves /var/www)
  *.zerops.app ───►              └─── location /mate/ ──► 127.0.0.1:3773  mate server (`zerops@mate`)
                    :22    sshd  (user: zerops)
                    systemd units `zerops@<name>.service`, created via `zsc unit create`
                    /var/www/<hostname>  ← sshfs mount of each sibling service's /var/www
```

Two structural facts that shape everything else:

- **nginx has two `location` blocks, both rendered from zcp's template**: `/` to code-server and,
  when `ZCP_MATE_ENABLED` is on, `/mate/` to the mate server on loopback (spec §2). It is not a
  general front door — anything else needs a template change.
- **`zcp init` is a `run.initCommands` boot step, so it re-runs on every container start** and
  re-renders nginx.conf from that template. Anything patched into nginx.conf at runtime is reverted
  by the next restart, so container-side changes belong in the template, never in a live edit.

## Where mate sits

The mate server binds `127.0.0.1:3773` only and is reached through nginx's `/mate/` location on the
container's public origin; there is no separate port, no pairing code and no shared secret. A
project member gets in through the Zerops-identity door: the client presents its own Zerops token
once at `POST /mate/api/auth/zerops-identity`, the server verifies membership with two platform
reads and discards it (spec §3). The three boundary rules and the ownership of every fact are spec
§0.

## Channels

| From → To                | Carries                           | Auth                                                | Needs VPN           | Verified                                     |
| ------------------------ | --------------------------------- | --------------------------------------------------- | ------------------- | -------------------------------------------- |
| client → Zerops API      | orgs, projects, services, env     | `Authorization: Bearer`                             | no                  | yes — CORS is `*`                            |
| client → zcp public URL  | everything the container serves   | cookie `__zcp_auth`                                 | no                  | yes — HTTP/2, ~86 ms, WS upgrade in template |
| client → mate server     | threads, agent, git, browser view | Zerops token once at the door (§3.2) → session → WS | no                  | yes — live on `z3-eval`                      |
| laptop → project VXLAN   | SSH, direct service ports         | WireGuard                                           | **yes**             | yes                                          |
| zcp → siblings           | sshfs mounts, `zcli push` deploys | SSH keys, pre-trusted VXLAN-wide                    | no (inside project) | yes                                          |
| agent in container → zcp | the `zerops_*` MCP tools          | none — stdio child process                          | no                  | yes                                          |
| zcp → Zerops API         | what the MCP tools act on         | Bearer (`ZCP_API_KEY` / zcli token)                 | no                  | yes                                          |

**SSH over VPN is the only way to run a command inside a container from outside.** There is no API,
webhook, or network-reachable MCP endpoint. Anything else has to be built.

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

`https://{service}-{subdomainPrefix}-{port}.{region}.zerops.app` — and for port 80 the port segment is
omitted: `https://{service}-{subdomainPrefix}.{region}.zerops.app` (measured 2026-09-04, `verified.md`)

`subdomainPrefix` comes from the project's `zeropsSubdomainHost`, which returns a **bare prefix**
with no domain, so it cannot supply the region. The region comes from the project's `publicZone`
(`fte23….prg1-zerops.zone` → `prg1`), which every project carries and which costs no extra request.
The service env `zeropsSubdomain` carries a whole ready-made URL too, but reading it means a
per-service `user-data` call, so it is the fallback rather than the default. H-01, the hardcoded
region, is paid back.
