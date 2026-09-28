/**
 * What heads a crewmate's chat (PRD §4.5): who it is — face, name, `@handle`,
 * the job's first line, the login it runs on when that is not the Mate's own —
 * the prompt version it runs on or the one its next turn brings in, and what
 * its menu offers. Read off the crew view; `null` while the crew is not read
 * yet or no longer lists the crewmate, when the header shows the thread's own
 * origin instead.
 *
 * Pure: no clock, no I/O.
 */
import {
  crewJobVersionWord,
  crewPendingWord,
  crewStintWord,
} from "@t3tools/client-runtime/zerops/crew/phrases";
import type { CrewView } from "@t3tools/client-runtime/zerops/projections/crew";
import {
  agentIdForProviderInstance,
  type CrewTint,
  type ThreadCrewOrigin,
  type ThreadId,
} from "@t3tools/contracts";

export interface CrewmateHeaderModel {
  readonly handle: string;
  readonly name: string;
  /** The crew's lead (PRD §4.6): marked as the lead beside its name. */
  readonly lead: boolean;
  readonly tint: CrewTint;
  readonly job: string;
  /** The login's label beside the name, for a crewmate not on the Mate's own Claude Code. */
  readonly login: string | null;
  /** `Job v4`; `v5 at next turn` / `Brief v5 at next turn` while its prompt is pending. */
  readonly version: { readonly label: string; readonly pending: boolean };
  /** *Previous conversations*: its other stints, newest first. */
  readonly previous: ReadonlyArray<{ readonly threadId: ThreadId; readonly label: string }>;
  /** Commits of its copy your tree does not have: what *Remove from crew* would discard. */
  readonly unlandedCommits: number;
  /** What *Forget memory* would clear (phase C); 0 hides it. */
  readonly memoryEntries: number;
}

export function crewmateHeaderModel(
  view: CrewView | null,
  origin: ThreadCrewOrigin,
  threadId: ThreadId,
): CrewmateHeaderModel | null {
  const row = view?.crewmates.find(({ crewmate }) => crewmate.handle === origin.crewmate);
  if (row === undefined) return null;
  const { crewmate, pending } = row;
  const pendingWord = pending === null ? null : crewPendingWord(pending);
  const version =
    pendingWord === null
      ? { label: crewJobVersionWord(crewmate.jobVersion), pending: false }
      : { label: pendingWord, pending: true };
  return {
    handle: crewmate.handle,
    name: crewmate.displayName,
    lead: crewmate.kind === "lead",
    tint: crewmate.tint,
    job: crewmate.jobFirstLine,
    login:
      agentIdForProviderInstance(crewmate.login.id) === "claude-code" ? null : crewmate.login.label,
    version,
    previous: crewmate.stints
      .filter((stint) => stint.threadId !== threadId)
      .toReversed()
      .map((stint) => ({
        threadId: stint.threadId,
        label: crewStintWord(stint.stint, stint.threadId === crewmate.currentThreadId),
      })),
    unlandedCommits: crewmate.lane?.ahead ?? 0,
    memoryEntries: crewmate.memory.entries,
  };
}
