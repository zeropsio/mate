# Remote Access

Zerops account access is the normal remote path. Pairing exists only for a standalone server run
outside Zerops.

## Zerops

Open `/mate/` on the `zcp` container's public subdomain and sign in with your Zerops account. The
Zerops identity door checks project membership and creates the authenticated connection. There is
no pairing code and no shared container secret.

A server running inside a Zerops project does not bootstrap browser sessions from pairing
credentials. It refuses that browser-session operation before consuming the credential.

## Standalone Server Pairing

Use this section only with a server installed from the GitHub release tarball and run outside
Zerops. From its installation directory, start a server on an address your other device can reach:

```bash
./node_modules/.bin/mate serve --host 192.168.1.42
```

The command prints the connection address, a one-time pairing token, a pairing URL, and a QR code.
Open the pairing URL on the other device or scan the QR code.

If the server is already running, mint a fresh pairing token without restarting it:

```bash
./node_modules/.bin/mate pair
```

Run `mate pair` from the installation that owns the server state. If the server was started with an
explicit `--base-dir`, pass the same directory to `mate pair`:

```bash
./node_modules/.bin/mate pair --base-dir /path/to/mate-data
```

The token is single-use. After the browser exchanges it, that browser uses its own authenticated
session; the original token is needed again only when pairing a new client.

### Network Setup

Bind `--host` to a trusted private address, such as an address on a VPN, instead of exposing the
standalone server broadly. The pairing URL must be reachable from the browser that opens it.

If you put the standalone server behind a reverse proxy path, start it with the matching
`--base-path`. The proxy must strip that prefix before forwarding requests to the server.

### Manage Access

The standalone executable can inspect and revoke pairing credentials and sessions:

```bash
./node_modules/.bin/mate auth --help
```

Use the nested help pages for the available pairing and session commands.

### Security Notes

- Treat pairing URLs and tokens like passwords.
- Anyone with a valid pairing credential can create a session until it expires or is revoked.
- Pairing credentials can leak through browser history, screenshots, logs, or copy and paste.
- Revoke credentials or sessions you no longer trust.

For server updates, see [Keeping Zerops Mate Current](./updating.md).
