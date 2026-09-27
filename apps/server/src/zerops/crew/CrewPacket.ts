/**
 * CrewPacket — what a crewmate is told at `SessionStart` (CONCEPT §3A.3):
 * the state packet on `startup`, `compact` and `clear`, and the resume delta
 * on `resume`. Built from the crew's own records, never from the transcript,
 * and written as facts: imperative out-of-band text can trip the model's
 * prompt-injection defences.
 *
 * **The packet** is at most 8,000 characters — the CLI swaps anything over
 * 10,000 for a file path and a 2,000-character preview it never asks the
 * model to read. Its parts come head first, so a preview would still keep
 * what matters most:
 *
 * 1. `crew-state seq N`, then the task as the board holds it (1,500);
 * 2. ground truth read over ssh: tip, status, the last check, resets since
 *    the last packet (900), and the diffstat against the dispatch commit;
 * 3. the task's handoff (2,000);
 * 4. the memory index, with `stale?` marks;
 * 5. unfiled lessons (1,000).
 *
 * Parts 1, 3, 5 and the fixed lines of 2 are cut at their share. Over 8,000,
 * the index is trimmed first, then the diffstat, each by whole lines.
 *
 * **The delta** is at most 1,000 characters. The CLI saves injected text in
 * the transcript and runs `SessionStart` on every resume, so a full packet on
 * each resume would stack stale tips; the delta says its seq supersedes the
 * earlier blocks and gives only the task's state and the ground truth. The
 * task's own words stay with its card, still in context.
 *
 * @module CrewPacket
 */
import type { CrewTaskState } from "@t3tools/contracts";

export const CREW_PACKET_MAX = 8_000;
export const CREW_DELTA_MAX = 1_000;
const TASK_SHARE = 1_500;
const GROUND_SHARE = 900;
const HANDOFF_SHARE = 2_000;
const UNFILED_SHARE = 1_000;

export interface PacketTask {
  readonly number: number;
  readonly title: string;
  readonly brief: string;
  readonly doneWhen: string;
  readonly state: CrewTaskState;
  readonly attempt: number;
  readonly dispatchCommit: string;
}

/** What the engine read in the copy over ssh, or why it could not. */
export type PacketGround =
  | {
      readonly tip: string;
      /** `git status --porcelain` lines. */
      readonly status: ReadonlyArray<string>;
      /** `git diff --stat <dispatch>` lines. */
      readonly diffstat: ReadonlyArray<string>;
      readonly lastCheck?: string;
      /** Resets of the copy since the last packet, as facts. */
      readonly resets: ReadonlyArray<string>;
    }
  | { readonly unavailable: string };

export interface PacketMemoryEntry {
  readonly id: string;
  readonly kind: string;
  readonly text: string;
  readonly stale: boolean;
}

export interface PacketInput {
  readonly seq: number;
  readonly task: PacketTask | undefined;
  readonly ground: PacketGround;
  readonly handoff: string | undefined;
  readonly index: ReadonlyArray<PacketMemoryEntry>;
  readonly unfiled: ReadonlyArray<{ readonly id: string; readonly text: string }>;
}

const clip = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;

const lines = (...parts: ReadonlyArray<string | undefined>): string =>
  parts.filter((part): part is string => part !== undefined).join("\n");

const taskPart = (task: PacketTask | undefined): string => {
  if (task === undefined) return lines("## Task", "No task is open.");
  const heading = `## Task #${task.number} (attempt ${task.attempt}, dispatched at ${task.dispatchCommit})`;
  const body = lines(
    task.title,
    task.brief.trim(),
    task.doneWhen.trim() === "" ? undefined : `Done when: ${task.doneWhen.trim()}`,
    `State: ${task.state}. The task is reported through crew_report.`,
  );
  return lines(heading, clip(body, TASK_SHARE - heading.length - 1));
};

/** Ground truth without its diffstat, cut at `share` by dropping status lines. */
const groundFacts = (ground: PacketGround, share: number): string => {
  if ("unavailable" in ground) return `Ground truth unavailable: ${ground.unavailable}`;
  const render = (statusShown: number): string =>
    lines(
      `tip ${ground.tip}`,
      ground.status.length === 0 ? "status: clean" : "status:",
      ...ground.status.slice(0, statusShown),
      statusShown < ground.status.length
        ? `… ${ground.status.length - statusShown} more changed paths`
        : undefined,
      ground.lastCheck === undefined ? undefined : `last check ${ground.lastCheck}`,
      ...ground.resets,
    );
  let shown = ground.status.length;
  let text = render(shown);
  while (text.length > share && shown > 0) text = render((shown -= 1));
  return clip(text, share);
};

const diffstatPart = (ground: PacketGround, shown: number): string | undefined => {
  if ("unavailable" in ground || ground.diffstat.length === 0) return undefined;
  return lines(
    "diffstat against the dispatch commit:",
    ...ground.diffstat.slice(0, shown),
    shown < ground.diffstat.length ? `… ${ground.diffstat.length - shown} more files` : undefined,
  );
};

const indexPart = (index: ReadonlyArray<PacketMemoryEntry>, shown: number): string | undefined => {
  if (index.length === 0) return undefined;
  return lines(
    "## Memory",
    ...index
      .slice(0, shown)
      .map(
        (entry) => `- ${entry.id} [${entry.kind}${entry.stale ? ", stale?" : ""}] ${entry.text}`,
      ),
    shown < index.length ? `… ${index.length - shown} more entries: crew_memory view` : undefined,
  );
};

const diffstatLength = (ground: PacketGround): number =>
  "unavailable" in ground ? 0 : ground.diffstat.length;

export const crewStatePacket = (input: PacketInput): string => {
  const head = `crew-state seq ${input.seq}`;
  const task = taskPart(input.task);
  const facts = groundFacts(input.ground, GROUND_SHARE);
  const handoff =
    input.handoff === undefined || input.handoff.trim() === ""
      ? undefined
      : lines("## Handoff", clip(input.handoff.trim(), HANDOFF_SHARE));
  const unfiled =
    input.unfiled.length === 0
      ? undefined
      : lines(
          "## Unfiled lessons",
          clip(
            input.unfiled.map((lesson) => `- ${lesson.id} ${lesson.text}`).join("\n"),
            UNFILED_SHARE,
          ),
        );
  const render = (indexShown: number, diffShown: number): string =>
    [
      head,
      task,
      lines("## Your copy now", facts, diffstatPart(input.ground, diffShown)),
      handoff,
      indexPart(input.index, indexShown),
      unfiled,
    ]
      .filter((part): part is string => part !== undefined)
      .join("\n\n");

  let indexShown = input.index.length;
  let diffShown = diffstatLength(input.ground);
  let packet = render(indexShown, diffShown);
  while (packet.length > CREW_PACKET_MAX && indexShown > 0)
    packet = render((indexShown -= 1), diffShown);
  while (packet.length > CREW_PACKET_MAX && diffShown > 0)
    packet = render(indexShown, (diffShown -= 1));
  return clip(packet, CREW_PACKET_MAX);
};

export const crewResumeDelta = (input: {
  readonly seq: number;
  readonly task: PacketTask | undefined;
  readonly ground: PacketGround;
}): string => {
  const head = `crew-state seq ${input.seq} supersedes earlier crew-state blocks.`;
  const task =
    input.task === undefined
      ? "No task is open."
      : `Task #${input.task.number} is ${input.task.state}, attempt ${input.task.attempt}.`;
  const facts = groundFacts(input.ground, CREW_DELTA_MAX - head.length - task.length - 2);
  const render = (diffShown: number): string =>
    lines(head, task, facts, diffstatPart(input.ground, diffShown));
  let diffShown = diffstatLength(input.ground);
  let delta = render(diffShown);
  while (delta.length > CREW_DELTA_MAX && diffShown > 0) delta = render((diffShown -= 1));
  return clip(delta, CREW_DELTA_MAX);
};
