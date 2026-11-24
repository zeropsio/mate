import type { MateLiveView } from "@t3tools/shared/hqMates";
import type { EnvironmentId, OrchestrationThreadShell } from "@t3tools/contracts";

/** What a Mate's computer is asked to do once the person confirms it. */
export type MateComputerVerb = "restart" | "stop";

export const MATE_VERB_LABELS: Readonly<
  Record<MateComputerVerb, { readonly press: string; readonly pending: string }>
> = {
  restart: { press: "Restart", pending: "Restarting…" },
  stop: { press: "Stop", pending: "Stopping…" },
};

/** What a restart does to a Mate with nothing running: the dialog's title already asks. */
export function idleRestartWords(name: string): string {
  return `${name}'s container stops and starts again, which takes a minute or two. Its conversations stay.`;
}

/** What a stop does to a Mate with nothing running: everything in its project, until Start. */
function idleStopWords(name: string): string {
  return `Everything in ${name}'s project stops, its preview included, until you start it again. Its code, files and conversations stay.`;
}

/** Every chat on the Mate the verb reaches, including one that is not on screen. */
export function mateVerbWords(
  verb: MateComputerVerb,
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
  const idle = verb === "stop" ? idleStopWords(name) : idleRestartWords(name);
  if (titles.length === 0) return idle;
  const list =
    titles.length === 1 ? titles[0] : `${titles.slice(0, -1).join(", ")} and ${titles.at(-1)}`;
  const turns = titles.length === 1 ? "that turn" : "those turns";
  return verb === "stop"
    ? `${name} is working on ${list}; stopping ends ${turns}. ${idle}`
    : `${name} is working on ${list}; restarting interrupts ${turns}.`;
}
