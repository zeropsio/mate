import type { HqRemoval } from "@t3tools/shared/hqStream";
interface RemovalSource {
  readonly appIds: ReadonlySet<string>;
  readonly projectIds: ReadonlySet<string>;
  readonly pressProjectIds?: ReadonlySet<string>;
  readonly forPerson: (userId: string) => {
    readonly apps: ReadonlyArray<{
      readonly id: string;
      readonly projects: ReadonlyArray<{ readonly projectId: string }>;
    }>;
    readonly ungrouped: ReadonlyArray<{ readonly projectId: string }>;
    readonly presses: Readonly<Record<string, unknown>>;
  };
}
/** Absence from a delivery is no proof. Only the source's authoritative membership can remove. */
export const navigationRemoval = (
  source: RemovalSource,
  userId: string,
  key: string,
  delivered: ReadonlySet<string> = new Set(),
): HqRemoval | undefined => {
  const view = source.forPerson(userId);
  if (key.startsWith("app:")) {
    const id = key.slice(4);
    if (view.apps.some((app) => app.id === id)) return;
    return { key, reason: !delivered.has(key) || source.appIds.has(id) ? "no-access" : "deleted" };
  }
  if (key.startsWith("project:")) {
    const id = key.slice(8);
    if (
      [...view.ungrouped, ...view.apps.flatMap((app) => app.projects)].some(
        (project) => project.projectId === id,
      )
    )
      return;
    return {
      key,
      reason: !delivered.has(key) || source.projectIds.has(id) ? "no-access" : "deleted",
    };
  }
  if (key.startsWith("press:") && !(key.slice(6) in view.presses))
    return {
      key,
      reason:
        !delivered.has(key) || source.pressProjectIds?.has(key.slice(6)) ? "no-access" : "deleted",
    };
  // People leaving this person's coverage are withheld, never alleged deleted from Zerops.
  if (key.startsWith("person:")) return { key, reason: "no-access" };
};
