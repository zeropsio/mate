/**
 * The group repo's tiers, turned into something the platform will import
 * (guide 4.3, `../gitea-mate/docs/group-repo.md`).
 *
 * ## What the group repo holds
 *
 * One directory per tier, exactly as `zcp/internal/recipe/layout.go` emits them
 * — the em dash is part of the name — each with an `import.yaml` describing a
 * whole environment: a dev/stage pair per codebase for the Mate tier, the same
 * without the container for Stage, and the HA shape for production. A Mate
 * proposes and updates them by pull request; a person with production rights
 * merges (D13).
 *
 * ## The one transform
 *
 * Every runtime service in a tier names its code repository in `buildFromGit`
 * and its build in `zeropsSetup`. The platform **cannot clone a private
 * repository**, and it refuses `zeropsSetup` without `buildFromGit` — so a tier
 * imported as written fails at the first service. Both keys come out and
 * `startWithoutCode: true` goes in: the services come up empty, and the code
 * arrives afterwards from the party that can actually push it (a Mate's zcp, or
 * the broker's deploy key for a group environment).
 *
 * What comes out with them is not thrown away. The **source map** —
 * `hostname → { repository, setup }` — is exactly how zcp adopts an environment
 * it did not create (guide 2.4) and how the broker maps a service back to a
 * repository, so it is returned beside the document rather than reconstructed
 * later from a YAML nobody kept.
 *
 * A managed service — Postgres, Valkey, a volume — has neither key and is
 * carried through byte for byte.
 *
 * ## Line-based, like everything else that touches these documents
 *
 * The tiers are written for people to read and carry comments that explain the
 * shape; a YAML round trip through a serializer drops every one of them. The
 * same reasoning as `recipeStore.ts` and `giteaRecipe.ts`, and the same
 * two-space layout to work against.
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module recipeTier
 */

/** The tier directories, spelled as the group repo spells them. */
export const RECIPE_TIER_PATHS = {
  mate: "0 — AI Agent/import.yaml",
  stage: "3 — Stage/import.yaml",
  production: "4 — Small Production/import.yaml",
} as const;

export type RecipeTier = keyof typeof RECIPE_TIER_PATHS;

/** The environments document, beside the tiers (guide 5.1). */
export const ENVIRONMENTS_DOCUMENT_PATH = "environments.yaml";

/** Where one service's code comes from, kept for zcp's adoption (guide 2.4). */
export interface RecipeServiceSource {
  /** The canonical clone URL the broker returned — `{slug}/{name}` on this Gitea. */
  readonly repository: string;
  /** The `zeropsSetup` that builds it. */
  readonly setup: string;
}

export interface ImportReadyTier {
  /** The document to import, services only. */
  readonly yaml: string;
  /** Every service in the document, in its order. */
  readonly services: ReadonlyArray<string>;
  /** The services that were converted, and where their code lives. */
  readonly sources: Readonly<Record<string, RecipeServiceSource>>;
}

const SERVICES_KEY = /^services:\s*$/u;
const ITEM_START = /^ {2}- /u;
const HOSTNAME = /^(?: {2}- | {4})hostname:\s*(\S+)/u;
const BUILD_FROM_GIT = /^(\s*)buildFromGit:\s*(\S.*)?$/u;
const ZEROPS_SETUP = /^(\s*)zeropsSetup:\s*(\S.*)?$/u;
const NESTED_URL = /^\s*url:\s*(\S.*)$/u;

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/**
 * A tier's `import.yaml`, ready to import, plus where each service's code
 * lives; `undefined` when the document declares no services at all.
 *
 * `undefined` rather than an empty result on purpose: a tier with no services
 * is a group repo whose recipe has not been merged yet, and *Add Mate* says so
 * instead of creating an empty project.
 */
export function importReadyTier(yaml: string): ImportReadyTier | undefined {
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

  const items: Array<Array<string>> = [];
  // Anything between `services:` and the first item — a comment the tier's
  // author wrote about the list as a whole, which belongs to no item and must
  // not be attached to one.
  const preamble: Array<string> = [];
  for (let index = start + 1; index < end; index += 1) {
    const line = lines[index] ?? "";
    if (ITEM_START.test(line)) items.push([line]);
    else if (items.length > 0) items.at(-1)!.push(line);
    else preamble.push(line);
  }
  if (items.length === 0) return undefined;

  const services: Array<string> = [];
  const sources: Record<string, RecipeServiceSource> = {};
  const converted: Array<string> = [];

  for (const item of items) {
    const hostname = hostnameOf(item);
    if (hostname !== undefined) services.push(hostname);
    const result = withoutCode(item);
    if (result.repository !== undefined && hostname !== undefined) {
      sources[hostname] = {
        repository: result.repository,
        // The platform defaults an unnamed setup to the hostname, and so does
        // this — a map that omitted it would send zcp looking for a setup that
        // is there under another name.
        setup: result.setup ?? hostname,
      };
    }
    converted.push(...result.lines);
  }

  return {
    yaml: [...lines.slice(0, start), "services:", ...preamble, ...converted, ...lines.slice(end)]
      .join("\n")
      .replace(/\n+$/u, "")
      .concat("\n"),
    services,
    sources,
  };
}

function hostnameOf(item: ReadonlyArray<string>): string | undefined {
  for (const line of item) {
    const match = HOSTNAME.exec(line);
    if (match?.[1] !== undefined) return match[1];
  }
  return undefined;
}

/**
 * One service item with its build taken out and `startWithoutCode: true` put
 * in its place — or untouched, when it had no build to take out.
 *
 * `startWithoutCode` goes in **where `buildFromGit` was**, so the key lands at
 * the item's own indentation whatever that is and the rest of the item keeps
 * its order and its comments.
 */
function withoutCode(item: ReadonlyArray<string>): {
  readonly lines: ReadonlyArray<string>;
  readonly repository: string | undefined;
  readonly setup: string | undefined;
} {
  let repository: string | undefined;
  let setup: string | undefined;
  const lines: Array<string> = [];
  let skippingBelow: number | null = null;

  for (const line of item) {
    // A `buildFromGit:` written as a block (`url:`, `ref:`) takes its nested
    // lines with it; a scalar has none and this never triggers.
    if (skippingBelow !== null) {
      if (line.trim().length === 0 || indentOf(line) > skippingBelow) {
        // A block-form build names its repository in `url:`; the scalar form
        // never reaches here.
        const url = NESTED_URL.exec(line);
        if (url?.[1] !== undefined && repository === undefined) repository = url[1].trim();
        continue;
      }
      skippingBelow = null;
    }

    const build = BUILD_FROM_GIT.exec(line);
    if (build) {
      const scalar = build[2]?.trim();
      if (scalar !== undefined && scalar.length > 0) repository = scalar;
      skippingBelow = build[1]?.length ?? 0;
      lines.push(`${build[1] ?? ""}startWithoutCode: true`);
      continue;
    }

    const zeropsSetup = ZEROPS_SETUP.exec(line);
    if (zeropsSetup) {
      setup = zeropsSetup[2]?.trim();
      skippingBelow = zeropsSetup[1]?.length ?? 0;
      continue;
    }

    lines.push(line);
  }

  // A `- buildFromGit:` that opened the item would have taken its `- ` with it;
  // the regexes only match a key at its own indentation, so that cannot happen
  // — but an item whose every line went is still nothing, and an empty item
  // would break the document.
  return {
    lines: lines.length === 0 ? item : lines,
    repository: repository === undefined || repository.length === 0 ? undefined : repository,
    setup,
  };
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
  const tagLines = (project.tagList ?? []).map((tag) => `    - ${tag}`);
  const header = [
    "project:",
    `  name: ${project.name}`,
    ...(tagLines.length > 0 ? ["  tags:", ...tagLines] : []),
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
    ...withoutKeys(lines.slice(block.start + 1, block.end), ["name", "tags"]),
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
  return new RegExp(`^\\s{1,2}${key}:`).test(line);
}
