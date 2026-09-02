# Keeping Zerops Code Current

## Zerops

The server version in a Zerops project is the GitHub release pinned by the container's version of
zcp. When that zcp pin moves, `zcp init` downloads the pinned release, verifies its digest, installs
it, and the `zerops@z3` unit runs that version.

Do not install or update z3 by hand inside the container. The next container initialization would
restore the release selected by zcp.

The web bundle at `/z3/` ships with that server release, so the normal Zerops web path keeps the
client and server together.

## Standalone Server

For a server you installed yourself, download the newer `zerops-code-<version>.tgz` and
`SHA256SUMS` from [zeropsio/mate releases](https://github.com/zeropsio/mate/releases), then verify the
tarball against `SHA256SUMS`.

Let active agent work and terminal commands finish, stop the standalone server, and install the
downloaded tarball in the same installation directory:

```bash
npm install /path/to/the/downloaded-tarball.tgz
./node_modules/.bin/z3 --version
./node_modules/.bin/z3 serve
```

Restart it with the same `--port`, `--base-path`, and `--base-dir` options used by the previous
version.

## Version Mismatch Warnings

A separately built client can warn when it is newer than the connected server. The warning appears
above the conversation composer and in **Settings** → **Connections**. Dismissing the conversation
warning hides only that client/server version pair; it does not update either side.

On Zerops, refresh the `/z3/` page first because its client bundle comes from the same release as
the server. For a standalone server, install the matching GitHub release tarball as described
above. This fork has no npm-registry update command, and the zcp-managed `zerops@z3` service does
not offer the repository's in-app background-service updater.

For remote connection setup, see [Remote Access](./remote-access.md).
