/**
 * What the client reads from a recipe's tiers — guide 4.3. The
 * repository is `group` in HQ, one per application.
 *
 * ## What the group repo holds
 *
 * One directory per tier, exactly as `zcp/internal/recipe/layout.go` emits them
 * — the em dash is part of the name — each with an `import.yaml` describing a
 * whole environment: a dev/stage pair per codebase for the Mate tier, the same
 * without the container for Stage, and the HA shape for production. A Mate
 * proposes and updates them by a change in HQ: Core lands one that only adds a
 * tier, and a person merges one that edits a tier.
 *
 * ## What each service of a tier is
 *
 * Read off the service's own keys, never guessed:
 *
 * - **managed** — no `buildFromGit`, no `zeropsSetup`, no `startWithoutCode`: a
 *   database, a cache, a storage. The platform runs it; none of the project's
 *   code does.
 * - **utility** — built from a repository the platform can clone itself:
 *   `buildFromGit` on github.com or gitlab.com, over https, with no userinfo,
 *   query or fragment.
 * - **stage** — any other runtime whose hostname ends in `stage`: zcp's name for
 *   a pair's stage half.
 * - **dev** — every other runtime: a pair's dev half, the Mate's clone target.
 *
 * HQ reads and converts the tier for imports. The web reads service details for its preview
 * and carries a Mate birth's project variables.
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module recipeTier
 */

import { fromYaml } from "@t3tools/shared/schemaYaml";
import * as Schema from "effect/Schema";

import { isPoolOrSandboxServiceType } from "./infrastructureType.ts";

/** The tier directories, spelled as an application's recipe repository spells them in HQ. */
export { RECIPE_TIER_PATHS, type RecipeTier } from "@t3tools/shared/hqRecipe";

/** A runtime of a tier: a pair's dev half, its stage half, or a public-build utility. */
export type RecipeRuntimeRole = "dev" | "stage" | "utility";

/** What a service of a tier is (the module's header). */
type RecipeServiceRole = "managed" | RecipeRuntimeRole;

interface RecipeTierService {
  readonly hostname: string;
  readonly role: RecipeServiceRole;
}

export interface RecipeRuntime {
  readonly hostname: string;
  readonly role: RecipeRuntimeRole;
}

export interface TierProjectVariable {
  readonly key: string;
  readonly value: string;
  readonly sensitive: boolean;
}

const decodeYaml = Schema.decodeUnknownSync(fromYaml(Schema.Unknown));

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

/** The project's own vault; service vaults stay in the import for Zerops to process. */
export function tierProjectVariables(yaml: string): ReadonlyArray<TierProjectVariable> {
  const lines = yaml.split("\n");
  const block = findProjectBlock(lines);
  if (block === null) return [];
  const project = record(
    record(decodeYaml(lines.slice(block.start, block.end).join("\n")))?.project,
  );
  if (project === undefined) throw new Error("The tier's project is not a mapping.");
  const variables: TierProjectVariable[] = [];
  const keys = new Set<string>();
  for (const [field, defaultSensitive] of [
    ["envVariables", false],
    ["envSecrets", true],
    ["vault", false],
  ] as const) {
    if (project[field] === undefined) continue;
    const entries = record(project[field]);
    if (entries === undefined) throw new Error(`The tier's ${field} is not a mapping.`);
    for (const [key, entry] of Object.entries(entries)) {
      const full = record(entry);
      const value = full === undefined ? entry : full.value;
      const sensitive =
        full === undefined ? defaultSensitive : (full.sensitive ?? defaultSensitive);
      if (
        (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") ||
        typeof sensitive !== "boolean" ||
        keys.has(key.toLowerCase())
      )
        throw new Error(`The tier's project variable ${key} is invalid or duplicated.`);
      keys.add(key.toLowerCase());
      variables.push({ key, value: String(value), sensitive });
    }
  }
  return variables;
}

// Indentation is the author's: a person's two spaces and zcp's four both
// read (Dara's tier, 2026-09-17, was four-space and read as "no recipe on
// main"). The list's own items are the dashes at its first item's column; a
// dash deeper in is a list inside a service — its ports, its mounts.
const SERVICES_KEY = /^services:\s*(?:#.*)?$/u;
const ITEM_OPENING = /^\s+-\s+(?=\S)/u;
const OWN_KEY = /^([A-Za-z][\w-]*)\s*:(.*)$/u;
const NESTED_URL = /^\s*url:(.*)$/u;

/** The keys that say a service runs code of its own: a build, its setup, an empty start. */
const CODE_KEYS: ReadonlySet<string> = new Set(["buildFromGit", "zeropsSetup", "startWithoutCode"]);

/** The only hosts whose repositories the platform clones with nobody's credentials. */
const PUBLIC_GIT_HOSTS: ReadonlySet<string> = new Set(["github.com", "gitlab.com"]);

/** One service of a tier: its lines, as written. */
interface TierItem {
  readonly lines: ReadonlyArray<string>;
  /** The indentation and the `- ` that open it; its own keys sit at this column. */
  readonly opening: string;
  readonly hostname: string | undefined;
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/** The tier's services, as written, or `undefined` when it declares none. */
function parseTier(yaml: string): ReadonlyArray<TierItem> | undefined {
  const lines = yaml.split("\n");
  const start = lines.findIndex((line) => SERVICES_KEY.test(line));
  if (start === -1) return undefined;

  // Everything under `services:` until the next top-level key.
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.trim().length > 0 && indentOf(line) === 0) {
      end = index;
      break;
    }
  }

  const items: Array<{ readonly lines: Array<string>; readonly opening: string }> = [];
  let column: number | undefined;
  for (let index = start + 1; index < end; index += 1) {
    const line = lines[index] ?? "";
    const opening = ITEM_OPENING.exec(line)?.[0];
    if (opening !== undefined && (column === undefined || indentOf(line) === column)) {
      column = indentOf(line);
      items.push({ lines: [line], opening });
    } else if (items.length > 0) items.at(-1)!.lines.push(line);
  }
  if (items.length === 0) return undefined;

  return items.map((item) => ({ ...item, hostname: ownScalar(item, "hostname") }));
}

type ItemLines = Pick<TierItem, "lines" | "opening">;

/** The key a line of an item states at the item's own column; nested lines and comments state none. */
function ownKey(
  item: ItemLines,
  index: number,
): { readonly key: string; readonly rest: string } | undefined {
  const line = item.lines[index] ?? "";
  const column = item.opening.length;
  if (index > 0 && indentOf(line) !== column) return undefined;
  const match = OWN_KEY.exec(line.slice(column));
  return match?.[1] === undefined ? undefined : { key: match[1], rest: match[2] ?? "" };
}

function ownKeyAt(item: ItemLines, key: string): number | undefined {
  const at = item.lines.findIndex((_, index) => ownKey(item, index)?.key === key);
  return at === -1 ? undefined : at;
}

/** A plain scalar: its quotes and any trailing comment off, `undefined` when there is none. */
function scalar(rest: string): string | undefined {
  const trimmed = rest.trim();
  const quoted = /^(["'])(.*)\1(?:\s+#.*)?$/u.exec(trimmed);
  const value = quoted === null ? trimmed.replace(/(?:^|\s+)#.*$/u, "").trim() : (quoted[2] ?? "");
  return value.length === 0 ? undefined : value;
}

function ownScalar(item: ItemLines, key: string): string | undefined {
  const at = ownKeyAt(item, key);
  return at === undefined ? undefined : scalar(ownKey(item, at)?.rest ?? "");
}

/** The repository a service builds from — a scalar, or a block's `url:`. */
function repositoryOf(item: TierItem): string | undefined {
  const at = ownKeyAt(item, "buildFromGit");
  if (at === undefined) return undefined;
  const own = scalar(ownKey(item, at)?.rest ?? "");
  if (own !== undefined) return own;
  const column = item.opening.length;
  for (const line of item.lines.slice(at + 1)) {
    if (line.trim().length > 0 && indentOf(line) <= column) break;
    const url = NESTED_URL.exec(line);
    if (url !== null) return scalar(url[1] ?? "");
  }
  return undefined;
}

/** A repository the platform clones itself (the module's header). */
function isPublicRepository(repository: string): boolean {
  // A query or a fragment, even an empty one, makes it something other than a plain clone.
  if (/[?#]/u.test(repository)) return false;
  let url: URL;
  try {
    url = new URL(repository);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    PUBLIC_GIT_HOSTS.has(url.hostname) &&
    url.port === "" &&
    url.username === "" &&
    url.password === ""
  );
}

/** A pair's stage half by name: `…stage`, the literal `stage` included. The one answer every site reads. */
export function isStageHostname(hostname: string): boolean {
  return hostname.endsWith("stage");
}

function roleOf(item: TierItem): RecipeServiceRole {
  // A pool or a Box is infrastructure the platform runs for the app, never the app's dev or stage
  // runtime — whatever code keys a tier writes beside it, it is imported with the managed part.
  const type = ownScalar(item, "type");
  if (type !== undefined && isPoolOrSandboxServiceType(type)) return "managed";
  if ([...CODE_KEYS].every((key) => ownKeyAt(item, key) === undefined)) return "managed";
  const repository = repositoryOf(item);
  if (repository !== undefined && isPublicRepository(repository)) return "utility";
  return item.hostname !== undefined && isStageHostname(item.hostname) ? "stage" : "dev";
}

/** Every service of a tier and what it is, in its order; `undefined` when it declares none. */
export function recipeTierServices(yaml: string): ReadonlyArray<RecipeTierService> | undefined {
  const tier = parseTier(yaml);
  if (tier === undefined) return undefined;
  return tier.flatMap((item) =>
    item.hostname === undefined ? [] : [{ hostname: item.hostname, role: roleOf(item) }],
  );
}

/**
 * How each service of the tier runs, as written: whether it has code of its own (a runtime),
 * whether it is highly available (a `:ha` type or the legacy `mode: HA`), and the copies it starts
 * on (`minContainers`, one where it says none). What a production's shape is weighed against before
 * the person answers who it is for. Object storage runs no container of the project's, so it is
 * not among them. `undefined` when it declares none.
 */
export function recipeTierRunning(yaml: string):
  | ReadonlyArray<{
      readonly hostname: string;
      readonly type: string;
      readonly runtime: boolean;
      readonly highlyAvailable: boolean;
      readonly copies: number;
    }>
  | undefined {
  const tier = parseTier(yaml);
  if (tier === undefined) return undefined;
  return tier.flatMap((item) => {
    const type = ownScalar(item, "type") ?? "";
    if (item.hostname === undefined || type.startsWith("object-storage")) return [];
    const copies = Number(ownScalar(item, "minContainers") ?? "1");
    return [
      {
        hostname: item.hostname,
        type,
        runtime: roleOf(item) !== "managed",
        highlyAvailable: type.includes(":ha") || ownScalar(item, "mode") === "HA",
        copies: Number.isFinite(copies) && copies >= 1 ? copies : 1,
      },
    ];
  });
}

/**
 * Each service of the tier with the `type` it declares (`postgresql@18`), as written: what a
 * production's first release creates, named before it is pressed.
 */
export function recipeTierServiceTypes(
  yaml: string,
): ReadonlyArray<{ readonly hostname: string; readonly type: string | undefined }> | undefined {
  const tier = parseTier(yaml);
  if (tier === undefined) return undefined;
  return tier.flatMap((item) =>
    item.hostname === undefined ? [] : [{ hostname: item.hostname, type: ownScalar(item, "type") }],
  );
}

/**
 * Where each built service's code lives, by hostname: its `buildFromGit`,
 * which is where a deploy's commit statuses are (`groupDeploys.ts`).
 */
export function recipeTierRepositories(yaml: string): ReadonlyMap<string, string> {
  const repositories = new Map<string, string>();
  for (const item of parseTier(yaml) ?? []) {
    const repository = repositoryOf(item);
    if (item.hostname !== undefined && repository !== undefined) {
      repositories.set(item.hostname, repository);
    }
  }
  return repositories;
}

/** The setup each runtime builds with, by hostname: its `zeropsSetup` — a preview's part. */
export function recipeTierSetups(yaml: string): ReadonlyMap<string, string> {
  const setups = new Map<string, string>();
  for (const item of parseTier(yaml) ?? []) {
    const setup = ownScalar(item, "zeropsSetup");
    if (item.hostname !== undefined && setup !== undefined) setups.set(item.hostname, setup);
  }
  return setups;
}

/** The `project:` block's bounds, or `null` when the document has none. */
function findProjectBlock(
  lines: ReadonlyArray<string>,
): { readonly start: number; readonly end: number } | null {
  const start = lines.findIndex((line) => /^project:\s*(#.*)?$/.test(line));
  if (start === -1) return null;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^[^\s#-]/.test(lines[index] ?? "")) {
      end = index;
      break;
    }
  }
  return { start, end };
}
