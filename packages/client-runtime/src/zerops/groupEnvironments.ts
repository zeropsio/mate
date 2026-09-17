/**
 * *Add stage* and *Add production* — the three writes they make (guide 5.2).
 *
 * A group environment is a Zerops project created from a tier, plus three facts
 * written where the parties that need them can read them:
 *
 * 1. the **registry** (`mate:gm:{groupId}:{projectId}:stage|production`), which
 *    is how the app and the broker know the project belongs to the group
 *    (`groupCreation.ts`);
 * 2. the **broker's token grants**, so the one deploy key on the account can
 *    reach the new project — `BASIC_USER` on it, everything else it already
 *    holds kept, and its value never touched;
 * 3. **`environments.yaml`** on the group repo, which is the only place an
 *    environment's sources are declared and the only thing the broker reads to
 *    decide what to deploy (`../gitea-mate/docs/group-repo.md`).
 *
 * ## Always a pull request
 *
 * `main` on the group repo is protected: no direct push for anybody, merges by
 * the `release` team. So the third write is never a commit on `main` — it is a
 * branch `mate-app/env-{name}` and a pull request, which the app merges at once
 * when Gitea says this person may merge, and leaves open when it does not.
 *
 * Whether they may is read from Gitea's own answer for that branch
 * (`user_can_merge` on `GET /repos/{o}/{r}/branches/main`), not from the role
 * the app happens to know: the mirror lags a role change by minutes, and a
 * merge the app decided to try and Gitea refuses is worse than a pull request
 * somebody approves (guide 4.5, "each fact from the party that can prove it").
 *
 * ## Public access
 *
 * Not here. `enable-subdomain-access` is refused before there is code
 * (measured), so the broker turns it on after the first deploy (5.2).
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module groupEnvironments
 */

import type { ZeropsRegistry } from "./groupRegistry.ts";
import { readZeropsGroupTags } from "./groups.ts";
import type { ZeropsProjectGrant } from "./groupReach.ts";

/** What a group environment is: a stage, or the one production. */
export type GroupEnvironmentTier = "stage" | "production";

/** One entry of `environments.yaml`. */
export interface GroupEnvironment {
  readonly name: string;
  readonly tier: GroupEnvironmentTier;
  /** The Zerops project it is. */
  readonly project: string;
  /**
   * The branches that feed it, or the literal `release` for a production —
   * the newest approved `v*` tag and nothing else.
   */
  readonly sources: ReadonlyArray<string> | "release";
  /** `on-push` (the default) or `on-request`. */
  readonly deploy: "on-push" | "on-request" | undefined;
}

/** A stage's default: it follows `main`, and every push to it deploys. */
export const DEFAULT_STAGE_SOURCES: ReadonlyArray<string> = ["main"];

/**
 * What an environment is called in `environments.yaml`, from the name a person
 * gave the project.
 *
 * It is not a display name: a workflow's deploy step asks for it by name, the
 * broker matches it, and it becomes a branch (`env/{name}`, `mate-app/env-
 * {name}`). So it is lower-case letters, digits and dashes, derived once and
 * numbered on a collision — the same rule, and the same reason, as a group's
 * slug (`groupRegistry.ts`).
 *
 * "Acme CRM - stage" becomes `acme-crm-stage`; a name with nothing usable in it
 * falls back to the tier, which is what the first one is called anyway.
 */
export function deriveEnvironmentName(
  displayName: string,
  tier: GroupEnvironmentTier,
  taken: ReadonlyArray<string> = [],
): string {
  const cleaned = displayName
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^[^a-z]+|-+$/gu, "");
  const base = cleaned.length === 0 ? tier : cleaned;
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new Error(`No free name for "${displayName}".`);
}

/** The branch an environment write goes on. */
export function environmentBranchName(name: string): string {
  return `mate-app/env-${name}`;
}

const ENVIRONMENTS_KEY = /^environments:\s*$/u;
const ENTRY_KEY = /^ {2}([^\s#:][^:]*):\s*(?:#.*)?$/u;
const TIER = /^ {4}tier:\s*(\S+)/u;
const PROJECT = /^ {4}project:\s*(\S+)/u;
const SOURCES = /^ {4}sources:\s*(\S.*)$/u;
const DEPLOY = /^ {4}deploy:\s*(\S+)/u;

/**
 * Every environment the document declares, in its order.
 *
 * Tolerant by design: it is a file people edit, and an entry this build cannot
 * make sense of is skipped rather than made to fail the whole read — the broker
 * is the authority on what it will deploy, and the app's job here is to show
 * what is there and refuse a second production.
 */
export function readGroupEnvironments(yaml: string): ReadonlyArray<GroupEnvironment> {
  const lines = yaml.split("\n");
  const start = lines.findIndex((line) => ENVIRONMENTS_KEY.test(line));
  if (start === -1) return [];

  const found: Array<GroupEnvironment> = [];
  let current: { name: string; body: Array<string> } | null = null;
  const flush = () => {
    if (current === null) return;
    const entry = entryOf(current.name, current.body);
    if (entry !== undefined) found.push(entry);
    current = null;
  };

  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.trim().length > 0 && !line.startsWith(" ")) break;
    const key = ENTRY_KEY.exec(line);
    if (key?.[1] !== undefined) {
      flush();
      current = { name: key[1].trim(), body: [] };
      continue;
    }
    current?.body.push(line);
  }
  flush();
  return found;
}

function entryOf(name: string, body: ReadonlyArray<string>): GroupEnvironment | undefined {
  const tier = first(body, TIER);
  const project = first(body, PROJECT);
  if (name.length === 0 || project === undefined) return undefined;
  if (tier !== "stage" && tier !== "production") return undefined;
  const sourcesRaw = first(body, SOURCES);
  const deploy = first(body, DEPLOY);
  return {
    name,
    tier,
    project,
    sources: readSources(sourcesRaw, tier),
    deploy: deploy === "on-push" || deploy === "on-request" ? deploy : undefined,
  };
}

function first(body: ReadonlyArray<string>, pattern: RegExp): string | undefined {
  for (const line of body) {
    const match = pattern.exec(line);
    if (match?.[1] !== undefined) return match[1].trim();
  }
  return undefined;
}

/**
 * `sources` is either the word `release` or a flow list of branches. A
 * production's is always `release` whatever it says — that is the only value
 * the broker accepts for one, and reading anything else back would show a
 * production following a branch, which cannot happen.
 */
function readSources(
  raw: string | undefined,
  tier: GroupEnvironmentTier,
): ReadonlyArray<string> | "release" {
  if (tier === "production") return "release";
  if (raw === undefined) return [];
  const list = raw.replace(/#.*$/u, "").trim();
  if (list === "release") return "release";
  return list
    .replace(/^\[|\]$/gu, "")
    .split(",")
    .map((entry) => entry.trim().replace(/^["']|["']$/gu, ""))
    .filter((entry) => entry.length > 0);
}

export type GroupEnvironmentWrite =
  | { readonly ok: true; readonly yaml: string; readonly branch: string }
  | { readonly ok: false; readonly reason: string };

/**
 * The document with one environment added.
 *
 * Line-based, so a `gates:` block, a comment or a key this build has never
 * heard of survives the write untouched — the file is the broker's contract and
 * a person's to edit, and re-emitting it through a serializer would quietly
 * drop half of it.
 *
 * An empty or absent document is given the header it needs; a file that already
 * declares environments keeps every one of them and gets the new block at the
 * end, where a diff reads as one addition.
 */
export function withGroupEnvironment(
  yaml: string,
  environment: GroupEnvironment,
): GroupEnvironmentWrite {
  const name = environment.name.trim();
  if (name.length === 0) return { ok: false, reason: "An environment needs a name." };
  if (!/^[a-z][a-z0-9-]*$/u.test(name)) {
    return { ok: false, reason: "An environment's name is lower-case letters, digits and dashes." };
  }

  const existing = readGroupEnvironments(yaml);
  if (existing.some((entry) => entry.name === name)) {
    return { ok: false, reason: `This project already has an environment called ${name}.` };
  }
  if (environment.tier === "production" && existing.some((entry) => entry.tier === "production")) {
    // One production per group (`docs/vocabulary.md`). Two would leave two
    // projects claiming the same release target with nothing to choose between.
    return { ok: false, reason: "This project already has a production." };
  }

  const block = blockFor({ ...environment, name });
  const lines = yaml.split("\n");
  const at = lines.findIndex((line) => ENVIRONMENTS_KEY.test(line));
  if (at === -1) {
    const header = yaml.trim().length === 0 ? [] : [...trimTrailingBlank(lines), ""];
    return {
      ok: true,
      yaml: document([...header, "version: 1", "environments:", ...block]),
      branch: environmentBranchName(name),
    };
  }

  // After the last line that belongs to the mapping, so the block lands inside
  // `environments:` and before whatever top-level key follows it.
  let end = lines.length;
  for (let index = at + 1; index < lines.length; index += 1) {
    if ((lines[index] ?? "").trim().length > 0 && !(lines[index] ?? "").startsWith(" ")) {
      end = index;
      break;
    }
  }
  const body = trimTrailingBlank(lines.slice(at + 1, end));
  return {
    ok: true,
    yaml: document([...lines.slice(0, at + 1), ...body, ...block, ...lines.slice(end)]),
    branch: environmentBranchName(name),
  };
}

/** One document, ending in exactly one newline whatever it was handed. */
function document(lines: ReadonlyArray<string>): string {
  return `${lines.join("\n").replace(/\n+$/u, "")}\n`;
}

function trimTrailingBlank(lines: ReadonlyArray<string>): ReadonlyArray<string> {
  let end = lines.length;
  while (end > 0 && (lines[end - 1] ?? "").trim().length === 0) end -= 1;
  return lines.slice(0, end);
}

function blockFor(environment: GroupEnvironment): ReadonlyArray<string> {
  const lines = [
    `  ${environment.name}:`,
    `    tier: ${environment.tier}`,
    `    project: ${environment.project}`,
  ];
  if (environment.tier === "production") {
    lines.push("    sources: release");
    return lines;
  }
  const sources = environment.sources === "release" ? DEFAULT_STAGE_SOURCES : environment.sources;
  lines.push(`    sources: [${sources.join(", ")}]`);
  lines.push(`    deploy: ${environment.deploy ?? "on-push"}`);
  return lines;
}

/** The commit message the write lands under. */
export function environmentCommitMessage(environment: {
  readonly name: string;
  readonly tier: GroupEnvironmentTier;
}): string {
  return `Add the ${environment.name} ${environment.tier} environment`;
}

/**
 * How the write reaches `main`.
 *
 * Always a pull request — `main` takes no direct push from anybody — and
 * merged in the same breath only when Gitea says this person may merge it.
 * `undefined` from Gitea is not a yes: a branch read that did not answer is a
 * pull request left open, which somebody can merge, rather than a merge call
 * that fails after the branch exists.
 */
export function planEnvironmentWrite(input: {
  readonly name: string;
  readonly userCanMerge: boolean | undefined;
}): { readonly branch: string; readonly merge: boolean } {
  return {
    branch: environmentBranchName(input.name),
    merge: input.userCanMerge === true,
  };
}

/** What the broker's Zerops token is called (`docs/vocabulary.md`). */
export const BROKER_TOKEN_NAME = "mate-broker";

/** An account minted before it had a Gitea has no broker to give anything to. */
export const NO_BROKER_REASON = "This account has no broker to deploy with yet.";

/** The broker's token, out of every token on the account. */
export function findBrokerToken<Token extends { readonly name: string }>(
  tokens: ReadonlyArray<Token>,
): Token | undefined {
  return tokens.find((token) => token.name === BROKER_TOKEN_NAME);
}

export type BrokerGrantWrite =
  | { readonly ok: true; readonly grants: ReadonlyArray<ZeropsProjectGrant> }
  | { readonly ok: false; readonly reason: string };

/**
 * The broker's grant list with one project added at `BASIC_USER`.
 *
 * The whole list, because `PUT /client/{org}/integration-token/{id}` replaces
 * it: a write carrying only the new grant would take the broker's reach away
 * from the Gitea project and every environment it already deploys. A project it
 * already reaches at `BASIC_USER` comes back **identical**, so the caller can
 * skip the write and a retried creation costs a read.
 *
 * Nothing here sees or produces the token's value. The grant list is metadata;
 * the value was minted once at sign-up and is never read again.
 */
export function withBrokerProjectGrant(
  current: ReadonlyArray<ZeropsProjectGrant> | undefined,
  projectId: string,
): BrokerGrantWrite {
  if (projectId.trim().length === 0) {
    return { ok: false, reason: "There is no project to give the broker." };
  }
  const grants = current ?? [];
  const already = grants.find((grant) => grant.projectId === projectId);
  if (already?.roleCode === "BASIC_USER") return { ok: true, grants };
  return {
    ok: true,
    grants: [
      ...grants.filter((grant) => grant.projectId !== projectId),
      { projectId, roleCode: "BASIC_USER" },
    ],
  };
}

/** What the account's token list says about one token: enough to plan a grant. */
export interface BrokerTokenLike {
  readonly name: string;
  readonly projects?: ReadonlyArray<ZeropsProjectGrant> | undefined;
}

/**
 * What to do so the broker reaches one project at `BASIC_USER`.
 *
 * `no-broker` is not a refusal: an account older than its Gitea has no broker
 * yet, and whether that stops the caller is the caller's call — a stage cannot
 * be deployed without one, a Mate is registered either way. `held` says the
 * broker already reaches the project, so a retry costs the read and nothing
 * else. `write` carries the broker's own token and its whole new grant list,
 * because the platform's write replaces the list.
 */
export type BrokerGrantPlan<Token extends BrokerTokenLike> =
  | { readonly kind: "no-broker"; readonly reason: string }
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "held"; readonly broker: Token }
  | {
      readonly kind: "write";
      readonly broker: Token;
      readonly projects: ReadonlyArray<ZeropsProjectGrant>;
    };

/** The grant one project needs from the broker, planned off the account's tokens. */
export function planBrokerProjectGrant<Token extends BrokerTokenLike>(
  tokens: ReadonlyArray<Token>,
  projectId: string,
): BrokerGrantPlan<Token> {
  const broker = findBrokerToken(tokens);
  if (broker === undefined) return { kind: "no-broker", reason: NO_BROKER_REASON };
  const write = withBrokerProjectGrant(broker.projects, projectId);
  if (!write.ok) return { kind: "refused", reason: write.reason };
  // An identical list is the same array back (`withBrokerProjectGrant`).
  if (write.grants === broker.projects) return { kind: "held", broker };
  return { kind: "write", broker, projects: write.grants };
}

/**
 * A stage or a production the account holds that the group does not know in
 * full: not in the registry as that kind, or not declared in
 * `environments.yaml`. The three writes that follow a creation's project live
 * in the page that made it, and a reload in that minute lost them — the
 * project ran, the page kept asking for the tier it already had (2026-09-17).
 * The projects page finishes these on its next read.
 */
export interface HalfMadeGroupEnvironment {
  readonly groupId: string;
  readonly projectId: string;
  /** What the person called the project — the declared name derives from it. */
  readonly displayName: string;
  readonly tier: GroupEnvironmentTier;
}

export function halfMadeGroupEnvironments(input: {
  readonly projects: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly tagList?: ReadonlyArray<string> | undefined;
  }>;
  readonly registry: ZeropsRegistry;
  /** Per group, the projects its `environments.yaml` declares. */
  readonly declared: ReadonlyMap<string, ReadonlySet<string>>;
}): ReadonlyArray<HalfMadeGroupEnvironment> {
  const out: Array<HalfMadeGroupEnvironment> = [];
  for (const project of input.projects) {
    const tags = readZeropsGroupTags(project.tagList);
    if (tags.groupId === undefined) continue;
    const tier: GroupEnvironmentTier | undefined =
      tags.role === "stage" ? "stage" : tags.role === "prod" ? "production" : undefined;
    if (tier === undefined) continue;
    const group = input.registry.groups.find((entry) => entry.groupId === tags.groupId);
    if (group === undefined) continue;
    const registered = group.projects.some(
      (entry) => entry.projectId === project.id && entry.kind === tier,
    );
    const declared = input.declared.get(tags.groupId)?.has(project.id) ?? false;
    if (registered && declared) continue;
    out.push({ groupId: tags.groupId, projectId: project.id, displayName: project.name, tier });
  }
  return out;
}
