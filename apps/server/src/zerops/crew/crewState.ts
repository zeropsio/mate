/**
 * crewState — what the crew-state ref (`refs/t3/crew-state/<crew>`,
 * ARCHITECTURE §4) mirrors onto the home service, so a Mate that lost its
 * database finds the crew in git: the crew home's files, each crewmate's
 * memory and the board.
 *
 * | Path                                          | Holds                                    |
 * |-----------------------------------------------|------------------------------------------|
 * | `crew.yaml`, `brief.md`, `jobs/<handle>.md`   | the crew home                            |
 * | `memory/<handle>/index.json`                  | decisions, lessons, facts, open questions |
 * | `memory/<handle>/notes/<topic>.md`            | a note                                   |
 * | `memory/<handle>/handoffs/<task>.md`          | a task's handoff                         |
 * | `memory/<handle>/unfiled.json`                | lessons not filed yet                    |
 * | `board.json`                                  | the latest run and every task            |
 *
 * A change to memory, a task or the run marks the mirror behind; the next
 * flush bumps the crew's `seq` and writes it. Flushes run when the engine is
 * on the service anyway: at Apply, after a save, and at every turn's end.
 *
 * @module crewState
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { asRefusal, type AppliedCrew, type CrewCore } from "./crewCore.ts";
import { CREW_ID } from "./CrewHome.ts";
import type { CrewStateFile } from "./CrewStateRef.ts";
import type { CrewMemoryRow, CrewStoreChange } from "./CrewStore.ts";

/** The tables whose rows the mirror carries beside the crew home. */
export const MIRRORED_TABLES: ReadonlySet<CrewStoreChange["table"]> = new Set([
  "memory",
  "assignment",
  "run",
]);

const INDEX_KINDS: ReadonlySet<CrewMemoryRow["kind"]> = new Set([
  "decision",
  "lesson",
  "fact",
  "open",
]);

const encodeJson = Schema.encodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

/** A path segment from free text (a note's topic): what the state ref's paths allow. */
const segment = (value: string, fallback: string): string =>
  value.replace(/[^A-Za-z0-9._-]+/gu, "-").replace(/^[.-]+/u, "") || fallback;

const json = (path: string, value: unknown) =>
  encodeJson(value).pipe(
    Effect.orDie,
    Effect.map((content): CrewStateFile => ({ path, content: `${content}\n` })),
  );

/** Each crewmate's memory and the board, as files of the mirror. */
const mirrorFiles = (core: CrewCore, applied: AppliedCrew) =>
  Effect.gen(function* () {
    const files: Array<CrewStateFile> = [];
    for (const handle of applied.members.keys()) {
      const rows = yield* asRefusal(core.store.memory(CREW_ID, handle));
      if (rows.length === 0) continue;
      const entry = ({ crew: _crew, member: _member, ...rest }: CrewMemoryRow) => rest;
      files.push(
        yield* json(
          `memory/${handle}/index.json`,
          rows.filter((row) => INDEX_KINDS.has(row.kind)).map(entry),
        ),
      );
      for (const row of rows) {
        if (row.kind === "note") {
          files.push({
            path: `memory/${handle}/notes/${segment(row.topic ?? "", row.id)}.md`,
            content: `${row.text}\n`,
          });
        } else if (row.kind === "handoff") {
          files.push({
            path: `memory/${handle}/handoffs/${segment(row.fromAssignment ?? "", row.id)}.md`,
            content: `${row.text}\n`,
          });
        }
      }
      const unfiled = rows.filter((row) => row.kind === "unfiled");
      if (unfiled.length > 0) {
        files.push(yield* json(`memory/${handle}/unfiled.json`, unfiled.map(entry)));
      }
    }
    const run = applied.run;
    files.push(
      yield* json("board.json", {
        run:
          run === undefined
            ? null
            : {
                id: run.run,
                state: run.state,
                reason: run.reason,
                startedBy: run.startedBy,
                startedAt: run.startedAt,
                budgetUsd: run.budgetUsd,
                spentUsd: run.spentUsd,
              },
        tasks: (yield* asRefusal(core.store.assignments(CREW_ID))).map((task) => ({
          id: task.assignment,
          number: task.number,
          title: task.title,
          owner: task.member,
          source: task.source,
          state: task.state,
          dependsOn: task.dependsOn,
          attempt: task.attempt,
          run: task.run,
          landedCommit: task.landedCommit,
        })),
      }),
    );
    return files;
  });

/** Mirrors the crew onto the home service (`refs/t3/crew-state/main`) when the mirror is behind. */
export const flushState = (core: CrewCore) =>
  Effect.gen(function* () {
    if (core.memory.stateBehind) {
      core.memory.stateBehind = false;
      yield* asRefusal(core.store.bumpSeq(CREW_ID));
      yield* asRefusal(core.reload);
    }
    const applied = yield* core.applied;
    if (applied === undefined || applied.homeHost === null || applied.flushedSeq >= applied.seq) {
      return;
    }
    const files = [...(yield* core.home.read), ...(yield* mirrorFiles(core, applied))];
    yield* asRefusal(
      core.stateRef.flush({ crew: CREW_ID, host: applied.homeHost, seq: applied.seq, files }),
    );
    yield* asRefusal(core.reload);
  });
