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
