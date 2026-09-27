/**
 * A Mate's logins as the client lists them (crew mode's *Runs on*, PRD §2.3).
 *
 * A login is one coding agent signed in to one account in this project: the
 * two defaults (the agents' own) and every further login someone added — a
 * second Claude account, a Claude API key, a second Codex account. The server
 * lists them on the agent-auth feed (`ZeropsAgentAuthSnapshot.logins`); this
 * module adds what only the client holds — the crewmates that run on each,
 * from the crew feed — and answers the two questions the surfaces ask:
 *
 * - the coding-agents card: whose login each one is ({@link mateLoginSignerLine});
 * - the crewmate editor's Login picker: which ones this person's crew may run
 *   on ({@link mateLoginChoices}). N9: only a login you signed in yourself, or
 *   one a project token authorizes — the server's admission accepts exactly
 *   these, and refuses a turn on anything else.
 *
 * @module logins
 */
import type { CrewSnapshot, ZeropsAgentAuthSnapshot, ZeropsLogin } from "@t3tools/contracts";
import { zeropsLoginTitle, zeropsLoginUnavailableReason } from "@t3tools/shared/zeropsAgentAuth";

export interface MateLoginRow extends ZeropsLogin {
  /** "Claude Code", "Claude Code · work", "Claude API key". */
  readonly title: string;
  /** The handles of the crewmates that run on it, in roster order. */
  readonly crewmates: ReadonlyArray<string>;
}

/**
 * Every login the feed lists, titled, with its crewmates. A server from
 * before logins lists none — and runs no crew to pick one for.
 */
export function mateLoginRows(
  snapshot: ZeropsAgentAuthSnapshot | null | undefined,
  crew: Pick<CrewSnapshot, "crewmates"> | null | undefined,
): ReadonlyArray<MateLoginRow> {
  return (snapshot?.logins ?? []).map((login) => ({
    ...login,
    title: zeropsLoginTitle(login),
    crewmates: (crew?.crewmates ?? [])
      .filter((crewmate) => crewmate.login.id === login.id)
      .map((crewmate) => crewmate.handle),
  }));
}

/**
 * Whose login it is, in the row's own words. `nameOf` resolves a Zerops user
 * id to a name when the client knows one; without it the line says so without
 * pretending to know who.
 */
export function mateLoginSignerLine(
  login: ZeropsLogin,
  viewerId: string | undefined,
  nameOf?: (userId: string) => string | undefined,
): string {
  if (login.token) return "Authorized by a project token";
  const verb = login.kind === "apiKey" ? "Added" : "Signed in";
  const signer = login.signedInBy;
  if (signer === undefined) {
    if (login.state === "not-authorized") {
      return login.kind === "apiKey" ? "No key stored" : "Not signed in";
    }
    return login.kind === "apiKey" ? "Key not recorded" : "Sign-in not recorded";
  }
  if (signer === viewerId) return `${verb} by you`;
  const name = nameOf?.(signer)?.trim() ?? "";
  return name.length === 0 ? `${verb} by another member` : `${verb} by ${name}`;
}

export type MateLoginUse =
  | { readonly usable: true }
  | { readonly usable: false; readonly reason: string };

/** Whether `viewerId`'s crew may run on `login` — the server's admission, row for row. */
function mateLoginUse(login: ZeropsLogin, viewerId: string | undefined): MateLoginUse {
  if (login.state !== "authorized" && login.state !== "registering") {
    return { usable: false, reason: zeropsLoginUnavailableReason(login, login.state) };
  }
  if (login.token) return { usable: true };
  if (login.signedInBy === undefined) {
    return {
      usable: false,
      reason: "Its sign-in was not recorded by Zerops Mate, so nobody can run it.",
    };
  }
  return login.signedInBy === viewerId
    ? { usable: true }
    : {
        usable: false,
        reason: "Signed in by another project member — only their crews can use it.",
      };
}

/** The Login picker's rows: every login, and whether this person's crew may run on it (N9). */
export function mateLoginChoices(
  rows: ReadonlyArray<MateLoginRow>,
  viewerId: string | undefined,
): ReadonlyArray<MateLoginRow & { readonly use: MateLoginUse }> {
  return rows.map((row) => ({ ...row, use: mateLoginUse(row, viewerId) }));
}
