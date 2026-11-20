/**
 * How a login is named (crew mode's *Runs on*, PRD §2.3) — pure.
 *
 * A login is a provider instance. Each agent's default is its driver's default
 * instance (`claudeAgent`, `codex`, `antigravity`, `grok`, `cursor`), and its
 * signer is kept under the agent id (`claude-code`, …). Only Claude Code and
 * Codex take more: every other login is `<driver>-<slug>`, never a default's
 * id, never an agent id, and its own signer key — so a second Claude login can
 * never be read as the first one's (D6 per login).
 *
 * @module zeropsLoginIds
 */
import {
  driverKindForAgent,
  type ZeropsAgentId,
  type ZeropsLoginAddInput,
} from "@t3tools/contracts";

/**
 * The agents that take a login beyond their default: a further login is a home of its own that
 * their driver runs in (`CLAUDE_CONFIG_DIR`, Codex's shadow home). The others sign in with one
 * account.
 */
const EXTRA_LOGIN_AGENTS = ["claude-code", "codex"] as const satisfies ReadonlyArray<ZeropsAgentId>;
export type ExtraLoginAgent = (typeof EXTRA_LOGIN_AGENTS)[number];

export const isExtraLoginAgent = (agent: ZeropsAgentId): agent is ExtraLoginAgent =>
  (EXTRA_LOGIN_AGENTS as ReadonlyArray<ZeropsAgentId>).includes(agent);

/** `ProviderInstanceId`'s length limit. */
const LOGIN_ID_MAX_LENGTH = 64;

const EXTRA_LOGIN_ID = /^(claudeAgent|codex)-[a-zA-Z0-9_-]+$/;

/** The agent another login runs, or `undefined` for an id that is not one. */
export function extraLoginAgent(id: string): ExtraLoginAgent | undefined {
  if (id.length > LOGIN_ID_MAX_LENGTH) return undefined;
  const driver = EXTRA_LOGIN_ID.exec(id)?.[1];
  return EXTRA_LOGIN_AGENTS.find((agent) => driverKindForAgent(agent) === driver);
}

/** Room for `<driver>-` and a `-NN` suffix inside {@link LOGIN_ID_MAX_LENGTH}. */
const SLUG_MAX_LENGTH = 40;

const slugOf = (label: string): string =>
  label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/g, "");

/** The id for a new login: its label as a slug, numbered past the ids already `taken`. */
export function makeExtraLoginId(
  input: Pick<ZeropsLoginAddInput, "kind" | "label"> & { readonly agent: ExtraLoginAgent },
  taken: ReadonlySet<string>,
): string {
  const slug = slugOf(input.label) || (input.kind === "apiKey" ? "api-key" : "account");
  const base = `${driverKindForAgent(input.agent)}-${slug}`;
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}
