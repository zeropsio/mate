/** Long enough for a slow round trip on a bad connection. */
const EXPIRY_MARGIN_MS = 30_000;

export interface CredentialLifetime {
  readonly expiresAtEpochMs?: number | undefined;
}

/**
 * Whether a stored bearer is past presenting: at or within one slow round trip
 * of its deadline. Its server can only refuse it, so it is never sent — the
 * connection is blocked on authentication at once and the door that minted it
 * mints another (a Zerops session ends after a day, and a tab left open longer
 * would otherwise present the dead one on every wake).
 *
 * `false` for a credential that carries no deadline: its server's refusal is
 * the only judge.
 */
export function credentialExpired(credential: CredentialLifetime, nowEpochMs: number): boolean {
  const expiresAtEpochMs = credential.expiresAtEpochMs;
  return expiresAtEpochMs !== undefined && nowEpochMs >= expiresAtEpochMs - EXPIRY_MARGIN_MS;
}
