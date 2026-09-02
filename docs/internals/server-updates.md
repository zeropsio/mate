# Server Update Architecture

> For maintainers. Using Zerops Code? See [docs/user](../user/).

The server does not download, install, or activate another version of itself. Release selection and
installation happen outside the running process.

## Zerops Containers

`zcp` selects a z3 GitHub release, pins its digest, downloads the release tarball, verifies it, and
installs it in the project container. The platform supervises that installed server as `zerops@z3`.
Changing the release pinned by zcp is therefore the update path; the server and web client do not
offer an in-app update action.

## Standalone Servers

A standalone operator downloads `zerops-code-<version>.tgz` and `SHA256SUMS` from a
[`zeropsio/mate` GitHub release](https://github.com/zeropsio/mate/releases), verifies the archive, and
installs that local tarball. See [the install guide](../user/install.md) for the commands.

`z3 service install` and `z3 service update` register the already installed server entry point with
the host service manager. They never fetch a package. To update a background service, install the
new release tarball first and then run that release's `z3 service update` command.

The service definition starts that exact installed entry point. It does not use a stable launcher,
an npm-installed version directory, trial activation, or database rollback. Normal database backup
and migration policy therefore applies before a standalone operator changes versions.

## Client and Wire Compatibility

New servers do not advertise a self-update capability, and clients have no server-update action or
progress state. A version mismatch explains the two real paths: zcp's pinned release on Zerops, or
a matching GitHub release tarball for a standalone server.

The legacy `server.updateServer` and `server.updateServerWithProgress` RPC names remain in the wire
contract and authorization table so mixed-version clients can still decode the protocol. The
server's compatibility handlers always refuse the request and direct installation outside the
running process. No runtime update implementation remains behind those handlers.

## Source Map

- Standalone service registration: `apps/server/src/cloud/bootService.ts`
- Compatibility-only RPC refusal: `apps/server/src/ws.ts`
- Environment capabilities: `packages/contracts/src/environment.ts`
- Version-mismatch guidance: `apps/web/src/versionSkew.ts`
- Zerops installation contract: `docs/internals/zerops/fork.md`
