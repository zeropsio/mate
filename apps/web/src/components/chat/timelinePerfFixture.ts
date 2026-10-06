/**
 * A long conversation for the timeline's incremental tests: many settled runs
 * — notes, thinking, commands with long output, reads, edits, a failing
 * command, operations, background tasks — and a live run at its end that
 * grows one entry at a time.
 */
import type { TimelineEntry } from "../../session-logic";
import { assistant, at, operation, reasoning, tool, user } from "./conversationFixtures";

const OUTPUT = Array.from(
  { length: 60 },
  (_, line) => `line ${line}: compiled module ${line} in ${line * 3}ms, no warnings found here`,
).join("\n");

/** Seconds into the conversation, as the fixtures' minute and second. */
function stamp(seconds: number): { minute: number; second: number } {
  return { minute: Math.floor(seconds / 60), second: seconds % 60 };
}

function atSeconds(seconds: number): string {
  const { minute, second } = stamp(seconds);
  return at(minute, second);
}

/** One run's entries from `start` (seconds): its own, the person's message first. */
export function perfTurn(index: number, start: number, steps: number): TimelineEntry[] {
  const turnId = `t${index}`;
  let clock = start;
  const next = () => {
    clock += 2;
    return clock;
  };
  const shift = (entry: TimelineEntry, seconds: number): TimelineEntry => {
    const iso = atSeconds(seconds);
    if (entry.kind === "message") {
      return {
        ...entry,
        createdAt: iso,
        message: { ...entry.message, createdAt: iso, updatedAt: atSeconds(seconds + 1) },
      };
    }
    if (entry.kind === "work") {
      return { ...entry, createdAt: iso, entry: { ...entry.entry, createdAt: iso } };
    }
    if (entry.kind === "operation") {
      return {
        ...entry,
        createdAt: iso,
        operation: { ...entry.operation, anchorAt: iso, settledAt: atSeconds(seconds + 1) },
      };
    }
    return { ...entry, createdAt: iso };
  };
  const entries: TimelineEntry[] = [shift(user(`u${index}`, 0, `please do task ${index}`), start)];
  for (let step = 0; step < steps; step += 1) {
    const id = `${turnId}-${step}`;
    switch (step % 7) {
      case 0:
        entries.push(shift(reasoning(`r-${id}`, turnId, 0), next()));
        break;
      case 1:
        entries.push(
          shift(
            tool(`c-${id}`, turnId, 0, {
              command: `pnpm test --filter ${step}`,
              detail: OUTPUT,
              itemType: "command_execution",
            }),
            next(),
          ),
        );
        break;
      case 2:
        entries.push(
          shift(
            tool(`read-${id}`, turnId, 0, {
              label: "Read file",
              command: undefined as never,
              toolName: "Read",
              itemType: "dynamic_tool_call",
              detail: `Read: src/file${step}.ts\n${OUTPUT}`,
            }),
            next(),
          ),
        );
        break;
      case 3:
        entries.push(
          shift(
            tool(`edit-${id}`, turnId, 0, {
              label: "Edited file",
              command: undefined as never,
              itemType: "file_change",
              changedFiles: [`src/file${step}.ts`],
              detail: `src/file${step}.ts`,
            }),
            next(),
          ),
        );
        break;
      case 4:
        entries.push(
          shift(assistant(`n-${id}`, turnId, 0, `Now checking part ${step} of the work.`), next()),
        );
        break;
      case 5:
        entries.push(
          shift(
            tool(`fail-${id}`, turnId, 0, {
              command: `pnpm lint ${step}`,
              detail: `${OUTPUT}\nError: exited with exit code 1`,
              itemType: "command_execution",
            }),
            next(),
          ),
        );
        break;
      default:
        if (index % 3 === 0) {
          entries.push(
            shift(
              operation(`op-${id}`, turnId, 0, { kind: "deploy", subject: `app${index}` }),
              next(),
            ),
          );
        } else {
          entries.push(
            shift(
              tool(`bg-${id}`, turnId, 0, {
                label: "Background task finished",
                command: undefined as never,
                toolCallId: undefined as never,
                tone: "info",
                sourceActivityKind: "task.completed",
                taskId: `task-${id}`,
                taskType: "local_bash",
                detail: "done",
              }),
              next(),
            ),
          );
        }
    }
  }
  entries.push(shift(assistant(`a${index}`, turnId, 0, `Done with task ${index}.`), next()));
  return entries;
}

/** Seconds a run of `steps` steps takes in the fixture, with room after it. */
export const perfTurnSeconds = (steps: number) => (steps + 4) * 2 + 120;

/** `turns` settled runs of `steps` steps each, a minute or two apart. */
export function perfConversation(turns: number, steps: number): TimelineEntry[] {
  return Array.from({ length: turns }, (_, index) =>
    perfTurn(index, index * perfTurnSeconds(steps), steps),
  ).flat();
}
