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
 *   these, and refuses a turn on anything else;
 * - the composer: whose login a thread spends ({@link resolveSpentLogin}), the
 *   way `ZeropsTurnAdmission` resolves it, so the client offers exactly the
 *   turns the server accepts (MA-12).
 *
 * @module logins
 */
import type {
  CrewSnapshot,
  ZeropsAgentAuth,
  ZeropsAgentAuthSnapshot,
  ZeropsLogin,
  ZeropsLoginState,
} from "@t3tools/contracts";
import {
  classifyZeropsAgentAuth,
  type ZeropsAgentAuthKind,
  zeropsAgentUnavailableReason,
  zeropsLoginTitle,
  zeropsLoginUnavailableReason,
} from "@t3tools/shared/zeropsAgentAuth";

import { resolveOwnedAgentId } from "./agentOwnership.ts";

export interface MateLoginRow extends ZeropsLogin {
  /** "Claude Code", "Claude Code · work", "Claude API key". */
  readonly title: string;
  /** The names of the crewmates that run on it, in roster order. */
  readonly crewmates: ReadonlyArray<string>;
  /** The lead's name when the lead is one of them; the card names it as the lead. */
  readonly lead: string | null;
}

/**
 * Every login the feed lists, titled, with its crewmates. A server from
 * before logins lists none — and runs no crew to pick one for.
 */
export function mateLoginRows(
  snapshot: ZeropsAgentAuthSnapshot | null | undefined,
  crew: Pick<CrewSnapshot, "crewmates"> | null | undefined,
): ReadonlyArray<MateLoginRow> {
  return (snapshot?.logins ?? []).map((login) => {
    const running = (crew?.crewmates ?? []).filter((crewmate) => crewmate.login.id === login.id);
    return {
      ...login,
      title: zeropsLoginTitle(login),
      crewmates: running.map((crewmate) => crewmate.displayName),
      lead: running.find((crewmate) => crewmate.kind === "lead")?.displayName ?? null,
    };
  });
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

/**
 * The agent-row fields that classify (`classifyZeropsAgentAuth`) as each
 * login state: a login beyond the defaults has no platform flag, its state is
 * already its own check's answer.
 */
const AGENT_ROW_FOR_STATE: Readonly<
  Record<ZeropsLoginState, Pick<ZeropsAgentAuth, "state" | "providerAuth" | "credPresent">>
> = {
  authorized: { state: "authorized", providerAuth: "authenticated", credPresent: true },
  registering: { state: "local-only", providerAuth: "unknown", credPresent: true },
  "needs-reauth": { state: "authorized", providerAuth: "unauthenticated", credPresent: true },
  reconnect: { state: "reconnect", providerAuth: "unknown", credPresent: false },
  "not-authorized": { state: "not-authorized", providerAuth: "unknown", credPresent: false },
};

/**
 * A login beyond the defaults as an agent row that classifies exactly as the
 * login does, with its own signer and walker — for the surfaces written
 * against agent rows (ownership, the composer's gate), so they answer for the
 * login and never for its agent's default one.
 */
export function mateLoginAsAgentRow(login: ZeropsLogin): ZeropsAgentAuth {
  const row = AGENT_ROW_FOR_STATE[login.state];
  return {
    agentId: login.agent,
    ...row,
    flagOAuth: row.state === "authorized",
    flagToken: login.token,
    ...(login.signedInBy === undefined ? {} : { authorizedBy: { subject: login.signedInBy } }),
    ...(login.login === undefined ? {} : { login: login.login }),
  };
}

/** The login a provider instance spends, and the key its signer record goes by. */
export interface SpentLogin {
  /** The agent id for an agent's own login; the login's id for any other. */
  readonly key: string;
  readonly agent: ZeropsAgentAuth;
}

/**
 * Whose login `instanceId` spends, as `ZeropsTurnAdmission` resolves it: a
 * login beyond the defaults by its own row — its state, its signer — and any
 * other instance by its driver's agent row. `undefined` for a driver Mate
 * signs nobody in to, and without a feed.
 */
export function resolveSpentLogin(
  instanceId: string | undefined,
  snapshot: ZeropsAgentAuthSnapshot | null | undefined,
  providers: ReadonlyArray<{ readonly instanceId: string; readonly driver: string }>,
): SpentLogin | undefined {
  if (instanceId === undefined || snapshot == null) return undefined;
  const login = snapshot.logins?.find((entry) => !entry.default && entry.id === instanceId);
  if (login !== undefined) return { key: login.id, agent: mateLoginAsAgentRow(login) };
  const agentId = resolveOwnedAgentId(instanceId, providers);
  const agent = snapshot.agents.find((entry) => entry.agentId === agentId);
  return agent === undefined ? undefined : { key: agent.agentId, agent };
}

/** The sign-in states a provider status can speak of, as the server words them. */
const UNAVAILABLE_KINDS: ReadonlyArray<Exclude<ZeropsAgentAuthKind["kind"], "authorized">> = [
  "registering",
  "reconnect",
  "needs-reauth",
  "not-authorized",
];

/**
 * Whether a provider status is only the server's word on a login the Mate signs people in to,
 * and so says nothing the person should read now: its "being registered" ever (that login runs
 * while it is registered, `ZeropsTurnAdmission` admits it, and nothing is the person's to do),
 * and its "not signed in" or "no longer works" once the sign-in feed says otherwise.
 *
 * The server's provider statuses and its sign-in feed are two streams, and either may be ahead —
 * the statuses are debounced, so right after a sign-in they still carry the answer from before
 * it while the composer has already picked the agent off the feed, and a red "unauthenticated"
 * flashed over a sign-in that had just worked. The feed is what the composer and the gate go
 * by, so it decides: a status the feed agrees with shows at once. Any other status — the
 * driver's own warning or error, a login disabled — is the person's to read.
 */
export function spentLoginStatusStale(
  status:
    | {
        readonly instanceId: string;
        readonly status: string;
        readonly message?: string | undefined;
      }
    | null
    | undefined,
  snapshot: ZeropsAgentAuthSnapshot | null | undefined,
  providers: ReadonlyArray<{ readonly instanceId: string; readonly driver: string }>,
): boolean {
  if (status == null || status.message === undefined) return false;
  if (status.status !== "warning" && status.status !== "error") return false;
  const spent = resolveSpentLogin(status.instanceId, snapshot, providers);
  if (spent === undefined) return false;
  const login = snapshot?.logins?.find((entry) => !entry.default && entry.id === spent.key);
  const spoken = UNAVAILABLE_KINDS.filter(
    (kind) =>
      status.message ===
      (login === undefined
        ? zeropsAgentUnavailableReason(spent.agent.agentId, kind)
        : zeropsLoginUnavailableReason(login, kind)),
  );
  // The driver's own words.
  if (spoken.length === 0) return false;
  if (spoken.includes("registering")) return true;
  const now = classifyZeropsAgentAuth(spent.agent).kind;
  return now === "authorized" || !spoken.includes(now);
}
