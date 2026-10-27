import type { MateLiveView } from "@t3tools/shared/hqMates";
import type { EnvironmentId, OrchestrationThreadShell } from "@t3tools/contracts";

/** Every chat on the Mate being restarted, including one that is not on screen. */
export function restartMateWords(
  name: string,
  environmentId: EnvironmentId | undefined,
  threads: ReadonlyArray<
    Pick<OrchestrationThreadShell, "title" | "session" | "latestTurn"> & {
      readonly environmentId: EnvironmentId;
    }
  >,
  told?: Pick<MateLiveView, "main" | "threads">,
): string {
  const local =
    environmentId === undefined
      ? []
      : threads.filter((thread) => thread.environmentId === environmentId);
  let titles =
    environmentId === undefined
      ? []
      : threads
          .filter(
            (thread) =>
              thread.environmentId === environmentId &&
              (thread.session?.activeTurnId != null || thread.latestTurn?.state === "running"),
          )
          .map((thread) => thread.title);
  if (local.length === 0 && told !== undefined) {
    const working = new Map<string, string>();
    if (told.main?.latestTurn?.state === "running") working.set(told.main.id, told.main.title);
    for (const thread of told.threads?.list ?? []) {
      if (thread.turnState === "running") working.set(thread.id, thread.title);
    }
    titles = [...working.values()];
  }
  if (titles.length === 0) return `Restart ${name}?`;
  const list =
    titles.length === 1 ? titles[0] : `${titles.slice(0, -1).join(", ")} and ${titles.at(-1)}`;
  return `${name} is working on ${list}; restarting interrupts ${titles.length === 1 ? "that turn" : "those turns"}.`;
}
