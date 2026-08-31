# Running Zerops Code in the Background

## Zerops

Every project's `zcp` container runs Zerops Code as the systemd unit `zerops@z3`. zcp creates and
supervises that unit; a user does not install, update, or remove it with z3 commands.

At container boot, `zcp init` downloads the z3 GitHub release pinned by that zcp version, verifies
its digest, and installs it. Nginx publishes the service at `/z3/` on the container's public
subdomain.

The service version therefore changes when the zcp release pin changes, not through an in-app
server update. See [Keeping Zerops Code Current](./updating.md).

## Standalone Server

This fork does not currently document a supported background-service installation outside Zerops.
The supported standalone path is the GitHub release tarball and its `z3 serve` executable; see
[Install Zerops Code](./install.md) and [Remote Access](./remote-access.md).
