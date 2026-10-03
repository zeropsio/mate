/**
 * The group repo's tiers, turned into what the platform imports — guide 4.3,
 * `../gitea-mate/docs/group-repo.md`.
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
 * The platform **cannot clone a private repository**, and it refuses
 * `zeropsSetup` without `buildFromGit`, so a runtime built from the
 * application's own repositories in HQ is imported without its build; its code
 * arrives afterwards from the party that can deploy it — a Mate's zcp, or HQ's
 * Core with the environment's deploy key. zcp reads which repository a runtime
 * comes from off the tier itself; nothing here carries that along.
 *
 * ## A Mate's tier comes in two imports ({@link splitRecipeTier})
 *
 * The managed part — the project block and the managed services — is imported
 * with the project. The runtimes follow as one import once the Mate has closed
 * the project off (`createEnvironment.ts`), so nothing that runs code ever
 * starts holding the Mate's key:
 *
 * - a dev half starts empty (`startWithoutCode: true`) — running, the clone
 *   target;
 * - a stage half waits at `READY_TO_DEPLOY` for its first deploy: no build and
 *   no `startWithoutCode`;
 * - a utility keeps `buildFromGit` and `zeropsSetup` verbatim, and the platform
 *   builds it;
 * - none keeps a `priority`: one wave, since everything a runtime could wait on
 *   was created by the first import.
 *
 * ## A stage or a production takes its tier whole ({@link deployTargetTier})
 *
 * An environment with no container has no Mate and nothing to close off, so its
 * tier goes in as one import, as it always has: every runtime starts empty for
 * HQ's Core to deploy onto, and a utility is built.
 *
 * ## Line-based, like everything else that touches these documents
 *
 * The tiers are written for people to read and carry comments that explain the
 * shape; a YAML round trip through a serializer drops every one of them, and
 * each service's own indentation — a person's two spaces or zcp's four — is the
 * one worked against.
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module recipeTier
 */

/** The tier directories, spelled as an application's recipe repository spells them in HQ. */
export { RECIPE_TIER_PATHS, type RecipeTier } from "@t3tools/shared/hqRecipe";

/** A runtime of a tier: a pair's dev half, its stage half, or a public-build utility. */
export type RecipeRuntimeRole = "dev" | "stage" | "utility";

/** What a service of a tier is (the module's header). */
export type RecipeServiceRole = "managed" | RecipeRuntimeRole;

export interface RecipeTierService {
  readonly hostname: string;
  readonly role: RecipeServiceRole;
}

export interface RecipeRuntime {
  readonly hostname: string;
  readonly role: RecipeRuntimeRole;
}

/** A tier's runtimes, as the one import that brings them up. */
export interface RecipeRuntimes {
  /** Services only, converted, with no `priority` and the document's header still first. */
  readonly yaml: string;
  /** Each runtime it creates, in the tier's order. */
  readonly services: ReadonlyArray<RecipeRuntime>;
}

/** A Mate's tier as its two imports ({@link splitRecipeTier}). */
export interface RecipeTierSplit {
  /**
   * The tier without its runtimes: its header, its project block and its
   * managed services, byte for byte — `services: []` when it has none.
   */
  readonly managed: string;
  /** The managed services' hostnames, in the tier's order. */
  readonly managedServices: ReadonlyArray<string>;
  /** Undefined for a tier of managed services alone. */
  readonly runtimes: RecipeRuntimes | undefined;
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
/** What a runtime of the Mate's second import comes without: its code keys and its wave. */
const RUNTIME_KEYS: ReadonlySet<string> = new Set([...CODE_KEYS, "priority"]);
const PRIORITY_KEY: ReadonlySet<string> = new Set(["priority"]);
const START_EMPTY = "startWithoutCode: true";

/** The only hosts whose repositories the platform clones with nobody's credentials. */
const PUBLIC_GIT_HOSTS: ReadonlySet<string> = new Set(["github.com", "gitlab.com"]);

/** One service of a tier: its lines, as written. */
interface TierItem {
  readonly lines: ReadonlyArray<string>;
  /** The indentation and the `- ` that open it; its own keys sit at this column. */
  readonly opening: string;
  readonly hostname: string | undefined;
}

interface ParsedTier {
  /** Everything before `services:` — the header, the project block. */
  readonly head: ReadonlyArray<string>;
  readonly servicesLine: string;
  /** What sits between `services:` and its first item: a comment about the list as a whole. */
  readonly preamble: ReadonlyArray<string>;
  readonly items: ReadonlyArray<TierItem>;
  /** Everything after the services block. */
  readonly tail: ReadonlyArray<string>;
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/** The tier's services, as written, or `undefined` when it declares none. */
function parseTier(yaml: string): ParsedTier | undefined {
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
  const preamble: Array<string> = [];
  let column: number | undefined;
  for (let index = start + 1; index < end; index += 1) {
    const line = lines[index] ?? "";
    const opening = ITEM_OPENING.exec(line)?.[0];
    if (opening !== undefined && (column === undefined || indentOf(line) === column)) {
      column = indentOf(line);
      items.push({ lines: [line], opening });
    } else if (items.length > 0) items.at(-1)!.lines.push(line);
    else preamble.push(line);
  }
  if (items.length === 0) return undefined;

  return {
    head: lines.slice(0, start),
    servicesLine: lines[start] ?? "services:",
    preamble,
    items: items.map((item) => ({ ...item, hostname: ownScalar(item, "hostname") })),
    tail: lines.slice(end),
  };
}

/** A document of the tier's own shape holding these items; `services: []` when there are none. */
function documentOf(tier: ParsedTier, items: ReadonlyArray<ReadonlyArray<string>>): string {
  return [
    ...tier.head,
    items.length === 0 ? "services: []" : tier.servicesLine,
    ...tier.preamble,
    ...items.flat(),
    ...tier.tail,
  ]
    .join("\n")
    .replace(/\n+$/u, "")
    .concat("\n");
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

function roleOf(item: TierItem): RecipeServiceRole {
  if ([...CODE_KEYS].every((key) => ownKeyAt(item, key) === undefined)) return "managed";
  const repository = repositoryOf(item);
  if (repository !== undefined && isPublicRepository(repository)) return "utility";
  return item.hostname?.endsWith("stage") === true ? "stage" : "dev";
}

/**
 * The item without the named keys, each with the lines nested under it, and
 * with `insert` where the first of them was — so an empty start lands at the
 * item's own indentation, taking the `- ` of a key that opened the item. A key
 * that opened the item and is simply gone hands its `- ` to the next of the
 * item's own keys; an item that would be left with nothing stays as it was.
 */
function rewritten(
  item: TierItem,
  drop: ReadonlySet<string>,
  insert?: string,
): ReadonlyArray<string> {
  const column = item.opening.length;
  const kept: Array<string> = [];
  let skipping = false;
  let insertAt: number | undefined;
  let openingDropped = false;
  item.lines.forEach((line, index) => {
    if (skipping) {
      if (line.trim().length === 0 || indentOf(line) > column) return;
      skipping = false;
    }
    const key = ownKey(item, index)?.key;
    if (key !== undefined && drop.has(key)) {
      skipping = true;
      openingDropped ||= index === 0;
      insertAt ??= kept.length;
      return;
    }
    kept.push(line);
  });
  if (insertAt === undefined) return item.lines;
  if (insert !== undefined) {
    kept.splice(insertAt, 0, `${openingDropped ? item.opening : " ".repeat(column)}${insert}`);
    return kept;
  }
  if (!openingDropped) return kept;
  const next = kept.findIndex(
    (line) => indentOf(line) === column && OWN_KEY.test(line.slice(column)),
  );
  if (next === -1) return item.lines;
  kept[next] = `${item.opening}${kept[next]!.slice(column)}`;
  return kept;
}

/** A runtime as the Mate's second import brings it up (the module's header). */
function asMateRuntime(item: TierItem, role: RecipeRuntimeRole): ReadonlyArray<string> {
  switch (role) {
    case "dev":
      return rewritten(item, RUNTIME_KEYS, START_EMPTY);
    case "stage":
      return rewritten(item, RUNTIME_KEYS);
    case "utility":
      return rewritten(item, PRIORITY_KEY);
  }
}

/** Every service of a tier and what it is, in its order; `undefined` when it declares none. */
export function recipeTierServices(yaml: string): ReadonlyArray<RecipeTierService> | undefined {
  const tier = parseTier(yaml);
  if (tier === undefined) return undefined;
  return tier.items.flatMap((item) =>
    item.hostname === undefined ? [] : [{ hostname: item.hostname, role: roleOf(item) }],
  );
}

/**
 * The hostnames of the tier's zcp services, by their own `type`: a Mate's tier declares none, its
 * press bringing the one container a project holds (audit D2).
 */
export function recipeTierZcpServices(yaml: string): ReadonlyArray<string> {
  return (parseTier(yaml)?.items ?? []).flatMap((item) =>
    item.hostname !== undefined && ownScalar(item, "type")?.startsWith("zcp@") === true
      ? [item.hostname]
      : [],
  );
}

/**
 * A Mate's tier as its two imports: the managed part, which goes in with the
 * project, and the runtimes, which go in once the project is closed off
 * (the module's header). `undefined` when the tier declares no services — a
 * group repo whose recipe has not been merged yet.
 */
export function splitRecipeTier(yaml: string): RecipeTierSplit | undefined {
  const tier = parseTier(yaml);
  if (tier === undefined) return undefined;
  const managed: Array<ReadonlyArray<string>> = [];
  const managedServices: Array<string> = [];
  const runtimeItems: Array<ReadonlyArray<string>> = [];
  const runtimes: Array<RecipeRuntime> = [];
  for (const item of tier.items) {
    const role = roleOf(item);
    if (role === "managed") {
      managed.push(item.lines);
      if (item.hostname !== undefined) managedServices.push(item.hostname);
      continue;
    }
    runtimeItems.push(asMateRuntime(item, role));
    if (item.hostname !== undefined) runtimes.push({ hostname: item.hostname, role });
  }
  return {
    managed: documentOf(tier, managed),
    managedServices,
    runtimes:
      runtimeItems.length === 0
        ? undefined
        : { yaml: recipeServicesYaml(documentOf(tier, runtimeItems)), services: runtimes },
  };
}

/**
 * A stage's or a production's tier, whole and ready for its one import: every
 * runtime built from the group's own repositories starts empty for HQ's Core
 * to deploy onto, a utility keeps its build, a managed service is carried
 * through byte for byte. `undefined` when the tier declares no services.
 */
export function deployTargetTier(yaml: string): string | undefined {
  const tier = parseTier(yaml);
  if (tier === undefined) return undefined;
  return documentOf(
    tier,
    tier.items.map((item) => {
      const role = roleOf(item);
      return role === "dev" || role === "stage"
        ? rewritten(item, CODE_KEYS, START_EMPTY)
        : item.lines;
    }),
  );
}

/**
 * Where each built service's code lives, by hostname: its `buildFromGit`,
 * which is where a deploy's commit statuses are (`groupDeploys.ts`).
 */
export function recipeTierRepositories(yaml: string): ReadonlyMap<string, string> {
  const repositories = new Map<string, string>();
  for (const item of parseTier(yaml)?.items ?? []) {
    const repository = repositoryOf(item);
    if (item.hostname !== undefined && repository !== undefined) {
      repositories.set(item.hostname, repository);
    }
  }
  return repositories;
}

/**
 * A services document without the services a project already has, so an
 * import asked for again — a reload between the import and the record of it —
 * creates only what is missing. `undefined` once nothing is.
 */
export function recipeServicesWithout(
  yaml: string,
  hostnames: ReadonlyArray<string>,
): string | undefined {
  const tier = parseTier(yaml);
  if (tier === undefined) return undefined;
  const present = new Set(hostnames);
  const missing = tier.items.filter(
    (item) => item.hostname === undefined || !present.has(item.hostname),
  );
  return missing.length === 0
    ? undefined
    : documentOf(
        tier,
        missing.map((item) => item.lines),
      );
}

/**
 * Strips a leading top-level `project:` block from a recipe.
 *
 * `zeropsio/recipes` publishes each tier as a whole-project import — a
 * `project:` block naming a new project, then `services:`. Importing into a
 * project that already exists takes the services alone, and the platform
 * rejects the rest outright, so this is the one transform between what a
 * recipe is published as and what the import endpoint accepts.
 *
 * Line-based on purpose: it removes a block that is by definition at column 0
 * and needs no YAML parser to find, and it leaves the services text
 * byte-identical rather than re-emitting it through a serializer that would
 * drop the comments the recipes carry for the reader.
 */
export function recipeServicesYaml(yaml: string): string {
  const lines = yaml.split("\n");
  const start = lines.findIndex((line) => /^project:\s*(#.*)?$/.test(line));
  if (start === -1) return yaml;

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    // The block ends at the next line that starts a new top-level key.
    if (/^[^\s#-]/.test(line)) {
      end = index;
      break;
    }
  }

  return [...lines.slice(0, start), ...lines.slice(end)].join("\n").replace(/^\n+/, "");
}

/**
 * The same recipe, aimed at `POST /client/{id}/project/import` — which creates
 * the project **and** its services in one call, from the tier exactly as
 * published.
 *
 * This is the path that should be taken whenever the environment does not
 * exist yet, and {@link recipeServicesYaml} is for the other case: adding
 * services to a project that is already there. The difference is not
 * cosmetic. Stripping the `project:` block takes its `envVariables` with it,
 * and a published tier puts real things there — `APP_KEY` in every Laravel
 * recipe, which is the app's encryption key. An environment created the
 * stripped way boots without one.
 *
 * Nor could the caller put them back afterwards: the values are preprocessor
 * directives, not values. Measured 2026-09-06 against a live import,
 * `APP_KEY: <@generateRandomString(<32>)>` came back as a real 32-character
 * secret, evaluated by the platform on the way in. Writing that literal into a
 * service env after the fact stores the directive as text.
 *
 * The project's `name` and `tagList` are the caller's, not the recipe's: the
 * recipe names a project after itself, and mate names it after the group and
 * tags it with the group's membership, which is what makes it findable at all
 * (`groups.ts`). Both are rewritten in place here, line by line, for the same
 * reason `recipeServicesYaml` is line-based — a recipe's comments are written
 * for whoever reads it next, and a YAML round-trip drops them.
 */
export function recipeProjectImportYaml(
  yaml: string,
  project: { readonly name: string; readonly tagList?: ReadonlyArray<string> },
): string {
  const lines = yaml.split("\n");
  const block = findProjectBlock(lines);
  // The block's own indentation, so a four-space recipe (zcp's) keeps one
  // mapping: a two-space `name` beside a four-space `envVariables` is two
  // indentations in one block, which is no YAML at all (Dara's stage tier,
  // 2026-09-17: the platform refused the import).
  const indent = block === null ? "  " : blockIndent(lines, block);
  const tagLines = (project.tagList ?? []).map((tag) => `${indent}  - ${tag}`);
  const header = [
    "project:",
    `${indent}name: ${project.name}`,
    ...(tagLines.length > 0 ? [`${indent}tags:`, ...tagLines] : []),
  ];

  // No project block at all — a services-only document. Give it one, after
  // the preprocessor header, which the platform requires to stay first.
  if (block === null) {
    const start = lines.findIndex((line) => line.trim().length > 0 && !line.startsWith("#"));
    const at = start === -1 ? lines.length : start;
    return [...lines.slice(0, at), ...header, "", ...lines.slice(at)].join("\n");
  }

  return [
    ...lines.slice(0, block.start),
    ...header,
    // The project's isolation is the press's alone to write (`runEnvironmentCreation.ts`): a
    // tier that named it, as a key or as a variable, would open a Mate's project at birth.
    ...withoutKeys(lines.slice(block.start + 1, block.end), [
      "name",
      "tags",
      "envIsolation",
    ]).filter((line) => !/^\s*envIsolation\s*:/u.test(line)),
    ...lines.slice(block.end),
  ].join("\n");
}

/**
 * The block's lines with the named keys removed, and with the list items that
 * belonged to a removed key removed alongside. One pass, because a key and its
 * items are one thing: dropping `tags:` and leaving its `- ` lines behind
 * produces a document the platform rejects.
 */
function withoutKeys(
  body: ReadonlyArray<string>,
  keys: ReadonlyArray<string>,
): ReadonlyArray<string> {
  const kept: Array<string> = [];
  let dropping = false;
  for (const line of body) {
    if (keys.some((key) => isBlockKey(line, key))) {
      dropping = true;
      continue;
    }
    if (dropping && /^\s+- /.test(line)) continue;
    if (line.trim().length > 0) dropping = false;
    kept.push(line);
  }
  return kept;
}

/** Whether this document describes a whole project, not just services. */
export function hasProjectBlock(yaml: string): boolean {
  return findProjectBlock(yaml.split("\n")) !== null;
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

function isBlockKey(line: string, key: string): boolean {
  return new RegExp(`^\\s+${key}:`).test(line);
}

/** The indentation the block's keys sit at — two spaces when it has none. */
function blockIndent(
  lines: ReadonlyArray<string>,
  block: { readonly start: number; readonly end: number },
): string {
  for (let index = block.start + 1; index < block.end; index += 1) {
    const line = lines[index] ?? "";
    if (line.trim().length === 0 || line.trim().startsWith("#")) continue;
    const width = line.length - line.trimStart().length;
    if (width > 0) return " ".repeat(width);
  }
  return "  ";
}
