# Install Zerops Mate

Zerops Mate runs in a Zerops project by default. A standalone server can also be installed from a
GitHub release tarball.

## Zerops

There is nothing to install by hand. Every project's `zcp` container installs the mate release pinned
by its version of zcp, verifies the release digest, and supervises the server as `zerops@mate`. Nginx
publishes the bundled web app at `/mate/` on the container's public subdomain.

Open that URL and sign in with your Zerops account. Project membership grants access; a Zerops
container does not use a pairing code or shared container secret.

The container provides the coding-agent environment. Provider status and configuration are
available in **Settings** after sign-in.

## Standalone Server

Use this path only when you are running the server yourself outside Zerops.

### Requirements

- Node.js `^22.16 || ^23.11 || >=24.10`
- At least one provider CLI installed and authenticated on the server machine

Download `zerops-mate-<version>.tgz` and `SHA256SUMS` from the
[latest GitHub release](https://github.com/zeropsio/mate/releases/latest), then verify the tarball
against `SHA256SUMS`. For one concrete verified example, the
[v0.1.0 release](https://github.com/zeropsio/mate/releases/tag/v0.1.0) contains
`zerops-mate-0.1.0.tgz` and its checksum file.

In a directory where you want to keep the standalone installation, place the tarball and run the
following commands, substituting the downloaded version for `0.1.0`:

```bash
npm init -y
npm install ./zerops-mate-0.1.0.tgz
./node_modules/.bin/mate --version
./node_modules/.bin/mate serve
```

The version command prints `mate v0.1.0`. `mate serve` starts the bundled web server and prints the
pairing details for this standalone installation.

The release package is named `zerops-mate`, but its executable is `mate`. It is not published to the
npm registry, so install the downloaded tarball rather than a registry package name.

Use the installed executable's help for the full CLI reference:

```bash
./node_modules/.bin/mate serve --help
```

The standalone server supports `--port`, `--base-path`, and `--base-dir`. Use `--base-path` when a
reverse proxy publishes the server below a path prefix, and keep using the same `--base-dir` when
you restart or update an installation whose state is stored outside the default directory.

Install and authenticate each provider CLI on the standalone server machine, not on the device
running the browser. See [Codex](./providers-codex.md) and [Claude](./providers-claude.md) for
provider-specific setup.

## Desktop and Mobile

This fork does not publish desktop or mobile clients. The `winget`, Homebrew, and AUR packages for
T3 Code are upstream packages and do not install Zerops Mate.

## Next Steps

- [Permission modes](./permission-modes.md): how much Zerops Mate asks before acting
- [Remote access](./remote-access.md): Zerops account access and standalone pairing
- [Keeping Zerops Mate current](./updating.md): Zerops pins and standalone release updates
- [Running in the background](./background-service.md): the service zcp manages on Zerops
