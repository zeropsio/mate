/**
 * How a login is named (crew mode's *Runs on*, PRD §2.3) — pure.
 *
 * A login is a provider instance. The two defaults are the drivers' default
 * instances (`claudeAgent`, `codex`), and their signers are kept under the
 * agent ids (`claude-code`, `codex`). Every other login is `<driver>-<slug>`:
 * never a default's id, never an agent id, and its own signer key — so a second
 * Claude login can never be read as the first one's (D6 per login).
 *
 * @module zeropsLoginIds
 */
import type { ZeropsAgentId, ZeropsLoginAddInput } from "@t3tools/contracts";

/** The agents Mate signs people in to — the defaults' signer keys. */
const AGENT_IDS: ReadonlyArray<ZeropsAgentId> = ["claude-code", "codex"];

/** The driver each agent's logins run on (`provider/Drivers/{Claude,Codex}Driver.ts`). */
export const LOGIN_DRIVER_KIND: Readonly<Record<ZeropsAgentId, "claudeAgent" | "codex">> = {
  "claude-code": "claudeAgent",
  codex: "codex",
};

/** `ProviderInstanceId`'s length limit. */
const LOGIN_ID_MAX_LENGTH = 64;

const EXTRA_LOGIN_ID = /^(claudeAgent|codex)-[a-zA-Z0-9_-]+$/;

/** The agent another login runs, or `undefined` for an id that is not one. */
export function extraLoginAgent(id: string): ZeropsAgentId | undefined {
  if (id.length > LOGIN_ID_MAX_LENGTH) return undefined;
  const driver = EXTRA_LOGIN_ID.exec(id)?.[1];
  return AGENT_IDS.find((agent) => LOGIN_DRIVER_KIND[agent] === driver);
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
  input: Pick<ZeropsLoginAddInput, "agent" | "kind" | "label">,
  taken: ReadonlySet<string>,
): string {
  const slug = slugOf(input.label) || (input.kind === "apiKey" ? "api-key" : "account");
  const base = `${LOGIN_DRIVER_KIND[input.agent]}-${slug}`;
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}
