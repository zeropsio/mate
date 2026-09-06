/**
 * The recipe store — what a group is made of, so a new environment can be
 * created without reading any existing one.
 *
 * This is the piece that removes the master from the model. Cloning an
 * environment by copying files out of a running container needs a container to
 * copy *from*, which makes that container load-bearing; storing the group's
 * import recipe beside the group's name means a new environment is created
 * from the store alone, and no member of a group is special.
 *
 * Ownership, spelled out because it is the part that is easy to get wrong:
 * **zcp writes, this client reads.** zcp sits at project level, understands
 * the service structure and already maintains the import as the app is built,
 * so it is the only party that can keep the recipe current. Mate never writes
 * a recipe and never reads a container to find one — it reads the store with
 * the user's own token to answer one question: does this group have a recipe
 * for the role the user is asking to create?
 *
 * The store itself is ordinary CRUD on the Zerops side, so the "who may see
 * this" question is the platform's, not ours: a caller sees exactly the groups
 * whose projects it can already see.
 *
 * {@link ZeropsRecipeStore} is the seam. {@link makeMockZeropsRecipeStore} is
 * the stand-in used until the real endpoints exist — it is seeded from
 * `zeropsio/recipes` and behaves like the real thing, including being empty
 * for a group nobody has published a recipe for.
 *
 * @module recipeStore
 */

import type { ZeropsEnvironmentRole } from "./groups.ts";

/** A group's durable record: everything about a group that is not its membership. */
export interface ZeropsGroupRecord {
  readonly groupId: string;
  /** The name the user typed. The tags carry the id; only this carries the name. */
  readonly name: string;
  /**
   * Import YAML per environment role, as `POST
   * /project/{id}/service-stack/import` wants it — services only, no `project:`
   * block (the platform rejects one with `projectImportProjectIncluded`).
   */
  readonly recipes: Readonly<Partial<Record<ZeropsEnvironmentRole, string>>>;
}

export interface ZeropsRecipeStore {
  readonly listGroups: () => Promise<ReadonlyArray<ZeropsGroupRecord>>;
  readonly readGroup: (groupId: string) => Promise<ZeropsGroupRecord | undefined>;
  readonly writeGroup: (record: ZeropsGroupRecord) => Promise<void>;
  readonly deleteGroup: (groupId: string) => Promise<void>;
}

/** Group id → display name, the shape `deriveZeropsGroups` takes. */
export function groupNamesFromRecords(
  records: ReadonlyArray<ZeropsGroupRecord>,
): Readonly<Record<string, string>> {
  const names: Record<string, string> = {};
  for (const record of records) names[record.groupId] = record.name;
  return names;
}

/**
 * Whether this group can create an environment of that role on a button, and
 * when it cannot, why — a missing recipe is the normal state of a group whose
 * app has not been published yet, not an error.
 */
export function canCreateEnvironment(
  record: ZeropsGroupRecord | undefined,
  role: ZeropsEnvironmentRole,
): { readonly allowed: boolean; readonly reason?: string } {
  if (record === undefined) {
    return { allowed: false, reason: "This group has no recipe yet." };
  }
  const recipe = record.recipes[role];
  if (recipe === undefined || recipe.trim().length === 0) {
    return { allowed: false, reason: `This group has no ${role} recipe yet.` };
  }
  return { allowed: true };
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

/**
 * An in-memory {@link ZeropsRecipeStore}. Seeded records are deep-frozen by
 * being plain data the caller never mutates; writes replace whole records, the
 * way a CRUD endpoint would.
 */
export function makeMockZeropsRecipeStore(
  seed: ReadonlyArray<ZeropsGroupRecord> = [],
): ZeropsRecipeStore {
  const records = new Map<string, ZeropsGroupRecord>(
    seed.map((record) => [record.groupId, record]),
  );

  return {
    listGroups: () => Promise.resolve([...records.values()]),
    readGroup: (groupId) => Promise.resolve(records.get(groupId)),
    writeGroup: (record) => {
      records.set(record.groupId, record);
      return Promise.resolve();
    },
    deleteGroup: (groupId) => {
      records.delete(groupId);
      return Promise.resolve();
    },
  };
}
