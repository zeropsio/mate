/**
 * *Add stage* and *Add production* — what makes a Zerops project an environment of its
 * application (guide 5.2, SPEC §3.2b), and what says one is half-made.
 *
 * An environment is a Zerops project created from a tier, attached to its application in the
 * organization's HQ as its stage or production — HQ records the environment with the attach, its
 * name, its sources and its place in the order — and keyed: the deploy token HQ deploys it with,
 * minted by the person's own client (`deployToken.ts`). Main's `environments.yaml` is read here only
 * while the Gitea deploy half still reads it.
 *
 * ## Public access
 *
 * Not here. `enable-subdomain-access` is refused before there is code (measured), so it is turned
 * on after the first deploy (5.2).
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module groupEnvironments
 */

import type { HqPlacement } from "./hq/placement.ts";
import type { ZeropsRegistry } from "./hq/registry.ts";
import { readZeropsMembership } from "./groups.ts";
import type { ZeropsEnvironmentRole } from "./groups.ts";
import { environmentKeyed } from "./deployToken.ts";

/** What a group environment is: a stage, or the one production. */
export type GroupEnvironmentTier = "stage" | "production";

/**
 * The tier a project's role tag puts it in, or `undefined` for a role that is
 * not an environment of the group — a Mate's own project holds `dev`.
 */
export function environmentTierForRole(
  role: ZeropsEnvironmentRole | undefined,
): GroupEnvironmentTier | undefined {
  return role === "stage" ? "stage" : role === "prod" ? "production" : undefined;
}

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

/**
 * A tier the group's recipe offers and the group does not have yet — the row
 * that asks. Once the recipe is on the group repo's `main`, a stage and a
 * production are the person's next steps, and a group that showed only its
 * Mate never said so (the owner, twice, 2026-09-17: "it never asked me to
 * setup production").
 */
export interface MissingEnvironmentRow {
  readonly kind: "missing-environment";
  readonly tier: GroupEnvironmentTier;
  readonly name: string;
  readonly line: string;
}

/** What a missing tier's row says. */
export const MISSING_ENVIRONMENT_LINE = "not set up yet";

/**
 * One row per tier the recipe offers on `main` and no declared environment
 * fills, stage before production — the order the person adds them in.
 */
export function missingEnvironmentRows(input: {
  /** The tiers whose import is on the group repo's `main`. */
  readonly tiersOnMain: ReadonlyArray<GroupEnvironmentTier>;
  readonly declarations: ReadonlyArray<Pick<GroupEnvironment, "tier">>;
  /**
   * The tiers the account already holds a project for. A declaration lands on
   * the group repo minutes after the environment is made, and until it does
   * the tier is declared nowhere — so the row that asks for it stood directly
   * under the environment the person was watching come up.
   */
  readonly filledTiers?: ReadonlyArray<GroupEnvironmentTier> | undefined;
}): ReadonlyArray<MissingEnvironmentRow> {
  const declared = new Set(input.declarations.map((entry) => entry.tier));
  const held = new Set(input.filledTiers ?? []);
  const offered = new Set(input.tiersOnMain);
  const order: ReadonlyArray<GroupEnvironmentTier> = ["stage", "production"];
  return order
    .filter((tier) => offered.has(tier) && !declared.has(tier) && !held.has(tier))
    .map((tier) => ({
      kind: "missing-environment",
      tier,
      name: tier === "stage" ? "Stage" : "Production",
      line: MISSING_ENVIRONMENT_LINE,
    }));
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

/**
 * A stage or a production the account holds that its application does not know in full: not
 * placed in HQ as that kind, held as no environment, or — for a person who may keep it — keyed
 * with no deploy token that works (main E07: an environment made before a deploy has none, and HQ
 * deploys nothing to it until somebody who may opens the page). The writes that follow a
 * creation's project live in the page that made it, and a reload in that minute lost them — the
 * project ran, the page kept asking for the tier it already had (2026-09-17). The projects page
 * finishes these on its next read.
 */
export interface HalfMadeGroupEnvironment {
  readonly groupId: string;
  readonly projectId: string;
  readonly tier: GroupEnvironmentTier;
}

export function halfMadeGroupEnvironments(input: {
  readonly projects: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    /** Where HQ places it (`ZeropsProject.hq`). */
    readonly hq?: HqPlacement | undefined;
  }>;
  readonly registry: ZeropsRegistry;
  /**
   * Per group, the environments HQ holds for it. A group missing here has not had them said:
   * nothing is half-made in it yet.
   */
  readonly environments: ReadonlyMap<
    string,
    ReadonlyArray<{
      readonly projectId: string;
      readonly keyHeld: boolean;
      readonly keyInvalid: boolean;
    }>
  >;
  /** Whether HQ's rule lets this person keep a project's deploy key (`keep_deploy_token`). */
  readonly mayKey: (projectId: string) => boolean;
}): ReadonlyArray<HalfMadeGroupEnvironment> {
  const out: Array<HalfMadeGroupEnvironment> = [];
  for (const project of input.projects) {
    const membership = readZeropsMembership(project);
    if (membership.groupId === undefined) continue;
    const tier = environmentTierForRole(membership.role);
    if (tier === undefined) continue;
    const group = input.registry.groups.find((entry) => entry.groupId === membership.groupId);
    if (group === undefined) continue;
    const environments = input.environments.get(membership.groupId);
    if (environments === undefined) continue;
    const registered = group.projects.some(
      (entry) => entry.projectId === project.id && entry.kind === tier,
    );
    const environment = environments.find((entry) => entry.projectId === project.id);
    const keyed =
      environment !== undefined && (environmentKeyed(environment) || !input.mayKey(project.id));
    if (registered && keyed) continue;
    out.push({ groupId: membership.groupId, projectId: project.id, tier });
  }
  return out;
}
