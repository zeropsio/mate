/**
 * The consent step of *Sign in with Zerops*, decided rather than performed.
 *
 * Gitea sends the person to the org's broker, the broker sends them here —
 * `{MATE_APP_URL}/gitea-signin?rid=…&broker=…` — and this page is where they
 * agree to it. One line and one button: everything else about the flow is the
 * broker's, and the app's whole contribution is proving who is standing here.
 *
 * ## The broker in the query string is a claim, not a fact
 *
 * A link is a link: anybody can send a person to this page naming any origin
 * as "the broker". If the page believed it, it would mint a throwaway for a
 * Gitea of the attacker's choosing and hand it to a server of the attacker's
 * choosing — and although a throwaway is worth almost nothing (it cannot mint,
 * raise itself or read a project), it *does* name its creator, and that is the
 * one thing this whole flow trades on.
 *
 * So the origin is matched against the brokers of the person's **own** Gitea
 * projects, read from their account. A `broker` nobody's account knows is
 * refused before a token exists.
 *
 * Pure: no clock, no network, no platform types (rule R1). The caller reads
 * the account's Gitea projects and hands them in.
 *
 * @module giteaSignIn
 */

/** One Gitea the person's account actually has, and where its broker answers. */
export interface KnownGiteaBroker {
  readonly brokerOrigin: string;
  readonly giteaOrigin: string;
  /** The org that holds this Gitea — where the throwaway is minted. */
  readonly clientId: string;
}

export type GiteaSignInRequest =
  | {
      readonly ok: true;
      readonly rid: string;
      readonly brokerOrigin: string;
      readonly giteaOrigin: string;
      /**
       * The org this Gitea belongs to. The throwaway is minted there and
       * nowhere else: a token from another org cannot read this org's tokens,
       * which is the second of the broker's six checks.
       */
      readonly clientId: string;
      /** What the person is signing in to, as the sentence spells it. */
      readonly giteaHost: string;
    }
  | { readonly ok: false; readonly reason: GiteaSignInRefusal };

export type GiteaSignInRefusal =
  /** The broker sent no request id, or an empty one. */
  | "missing-request"
  /** No `broker` in the query string at all. */
  | "missing-broker"
  /** A broker this person's account does not have. */
  | "unknown-broker";

function origin(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\/+$/u, "");
}

/** A URL's host, without scheme or path — what the sentence names. */
export function giteaHostOf(giteaOrigin: string): string {
  const withoutScheme = giteaOrigin.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//iu, "");
  return withoutScheme.split("/")[0] ?? "";
}

/**
 * Whether this consent request is one of the person's own, and what it is for.
 *
 * Compared as whole origins after trimming a trailing slash: a prefix match
 * would accept `https://broker-1-8080.prg1.zerops.app.attacker.example`, which
 * is exactly the trick this check exists to refuse.
 */
export function resolveGiteaSignInRequest(input: {
  readonly rid: string | null | undefined;
  readonly broker: string | null | undefined;
  readonly known: ReadonlyArray<KnownGiteaBroker>;
}): GiteaSignInRequest {
  const rid = (input.rid ?? "").trim();
  if (rid.length === 0) return { ok: false, reason: "missing-request" };

  const brokerOrigin = origin(input.broker);
  if (brokerOrigin.length === 0) return { ok: false, reason: "missing-broker" };

  const match = input.known.find((entry) => origin(entry.brokerOrigin) === brokerOrigin);
  if (match === undefined) return { ok: false, reason: "unknown-broker" };

  return {
    ok: true,
    rid,
    brokerOrigin,
    giteaOrigin: origin(match.giteaOrigin),
    giteaHost: giteaHostOf(match.giteaOrigin),
    clientId: match.clientId,
  };
}

/** What to tell the person when the request is not theirs to complete. */
export function giteaSignInRefusalMessage(reason: GiteaSignInRefusal): string {
  switch (reason) {
    case "missing-request":
      return "This sign-in link is incomplete. Start again from Gitea.";
    case "missing-broker":
      return "This sign-in link does not say which Gitea it is for.";
    case "unknown-broker":
      return "This sign-in is for a Gitea that is not on your account.";
  }
}
