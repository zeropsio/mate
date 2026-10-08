# Remote Access

Remote access to Zerops Mate uses your Zerops account.

## Zerops

Open `/mate/` on the `zcp` container's public subdomain and sign in with your Zerops account. The
Zerops identity door checks project membership and creates the authenticated connection. There is
no pairing code and no shared container secret.

A server running inside a Zerops project does not bootstrap browser sessions from pairing
credentials. It refuses that browser-session operation before consuming the credential.

## Antigravity Google Sign-In

Antigravity runs and saves its Google credentials on the selected environment. You can install it
and sign in from a remote web, desktop, or mobile client without an SSH login.

Start in **Settings** → **Providers** on web or desktop. On mobile, open **Settings** →
**Environments**, expand the environment, then choose **Set up Antigravity**.

After Google sign-in, a remote browser usually reaches a `127.0.0.1` page that cannot load. Copy
that full address into the return URL field in the same Zerops Mate client and confirm. Keep the
address unchanged, and do not paste the return URL into a thread or bug report.

See [Antigravity setup](./providers-antigravity.md) for installation, expiry, and account changes.

For server updates, see [Keeping Zerops Mate Current](./updating.md).
