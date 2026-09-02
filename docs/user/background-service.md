# Running Zerops Mate in the Background

## Zerops

Every project's `zcp` container runs Zerops Mate as the systemd unit `zerops@mate`. zcp creates and
supervises that unit; a user does not install, update, or remove it with mate commands.

At container boot, `zcp init` downloads the mate GitHub release pinned by that zcp version, verifies
its digest, and installs it. Nginx publishes the service at `/mate/` on the container's public
subdomain.

The service version therefore changes when the zcp release pin changes, not through an in-app
server update. See [Keeping Zerops Mate Current](./updating.md).

## Standalone Server

This fork does not currently document a supported background-service installation outside Zerops.
The supported standalone path is the GitHub release tarball and its `mate serve` executable; see
[Install Zerops Mate](./install.md) and [Remote Access](./remote-access.md).
