/**
 * The end of a session where it was issued — a Mate's (`POST …/api/auth/logout`) or an HQ's
 * (`DELETE …/api/session`) — presented with its own bearer. Nothing waits on the answer: an issuer
 * that does not answer lets the session end with its day.
 *
 * @module data/adapters/issuedSessions
 */
export function endIssuedSession(end: {
  readonly url: string;
  readonly method: "POST" | "DELETE";
  readonly token: string;
}): void {
  const send = globalThis.fetch.bind(globalThis);
  void send(end.url, {
    method: end.method,
    headers: { Authorization: `Bearer ${end.token}` },
    keepalive: true,
  }).catch(() => undefined);
}
