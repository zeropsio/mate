/**
 * Which coding agents a group's environments have actually signed in with.
 *
 * A new Mate added to a group should come up offering the agents the group
 * works with, not the platform's whole menu. The obvious source — the
 * `ZCP_AGENTS` selection its siblings were imported with — cannot be read:
 * `envSecrets` entries are `sensitive`, and the platform hands back
 * `REDACTED` for every one of them (measured 2026-09-07 against a live zcp:
 * `ZCP_AGENTS` and `ZCP_AGENT_AUTH_TYPE_CLAUDE_CODE` both redacted).
 *
 * `ZCP_AGENT_OAUTH_<SUFFIX>` is not. `zcp agent mark-oauth` writes it
 * **non-sensitive** on purpose — the GUI's flag read path redacts sensitive
 * entries — so it reads back as the literal `true` it was written as. That
 * makes it the better source anyway: it says which agents this environment is
 * *signed in with*, not which ones somebody once picked from a list.
 *
 * Nothing credential-shaped passes through here. The flag is a boolean marker
 * that an authorization happened; the credential itself is a file inside the
 * container (`~/.claude/.credentials.json`), which the mate server reports the
 * presence of and never the contents of (`spec-mate.md` §8.1), and no agent
 * token is ever written to an import document (MC-11).
 *
 * @module agentSelection
 */

import {
  ZEROPS_AGENT_TYPE_CANONICAL_ORDER,
  agentTypeToEnvSuffix,
  type ZeropsAgentType,
} from "./newProject.ts";

/** The env key zcp writes when an agent's login verifies. */
const OAUTH_FLAG_PREFIX = "ZCP_AGENT_OAUTH_";

/** Suffix back to agent type, derived from the one forward mapping so they cannot drift. */
const AGENT_BY_SUFFIX = new Map(
  ZEROPS_AGENT_TYPE_CANONICAL_ORDER.map((agentType) => [
    agentTypeToEnvSuffix(agentType),
    agentType,
  ]),
);

/**
 * zcp's own reading of a flag: `1` or `true`, case-insensitive, surrounding
 * space tolerated. `mark-oauth` only ever writes `true`, but the value is
 * visible in the Zerops GUI and therefore editable by hand, and a spelling
 * silently ignored there is indistinguishable from a broken feature.
 */
function readsAsOn(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true";
}

/**
 * The agents a container has authorized, in canonical order.
 *
 * Takes the raw `GET /service-stack/{id}/env` records so the caller never has
 * to know which key carries the answer — and so those records, which include
 * every redacted secret the service holds, stop at this boundary.
 */
export function agentsFromOAuthFlags(
  records: ReadonlyArray<{ readonly key: string; readonly content: string }>,
): ReadonlyArray<ZeropsAgentType> {
  const authorized = new Set<ZeropsAgentType>();
  for (const { key, content } of records) {
    if (!key.startsWith(OAUTH_FLAG_PREFIX) || !readsAsOn(content)) continue;
    const agentType = AGENT_BY_SUFFIX.get(key.slice(OAUTH_FLAG_PREFIX.length));
    if (agentType !== undefined) authorized.add(agentType);
  }
  return ZEROPS_AGENT_TYPE_CANONICAL_ORDER.filter((agentType) => authorized.has(agentType));
}

/** What a group's environments have authorized between them, in canonical order. */
export function unionAgents(
  perEnvironment: ReadonlyArray<ReadonlyArray<ZeropsAgentType>>,
): ReadonlyArray<ZeropsAgentType> {
  const all = new Set(perEnvironment.flat());
  return ZEROPS_AGENT_TYPE_CANONICAL_ORDER.filter((agentType) => all.has(agentType));
}
