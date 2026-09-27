/**
 * CrewMemory — a crewmate's memory (CONCEPT §3A.2, phase C): what outlasts
 * compaction and a fresh start, and the packet and delta built from it.
 *
 * - **Entries** are rows of `crew_memory`, one per id (`m<N>`). The index —
 *   decisions, lessons, facts and open questions of at most 200 characters —
 *   holds 30 entries or 2,500 characters; at the cap `add` asks the crewmate
 *   to merge or remove first. A note is read on demand (10 of 4,000); a
 *   handoff belongs to the open task (one, 2,000) and a new one replaces it;
 *   a fact keeps its paths and the tree's head, and is marked `stale?` once
 *   the tree changes those paths.
 * - **Every write changes one entry**: an operation yields at most one row
 *   to put or delete, never a regenerated memory (ACE, rulings §3A #8).
 * - **Lessons** from `crew_report` queue as unfiled entries, at most five,
 *   the oldest dropped; the crewmate files them itself.
 * - **The packet's memory** is the index with its marks, the open task's
 *   handoff and the unfiled queue (`crewPacketInput`); ground truth comes
 *   from one script over ssh (`groundFromFields`), and a crewmate without a
 *   copy has none.
 *
 * @module CrewMemory
 */
import type { PacketGround, PacketInput, PacketTask } from "./CrewPacket.ts";
import type { CrewMemoryOp, CrewToolText } from "./crewSeams.ts";
import type { CrewMemoryKind, CrewMemoryRow } from "./CrewStore.ts";

/** One `crew_memory` row, without the crew and the crewmate it belongs to. */
export type CrewMemoryEntry = Omit<CrewMemoryRow, "crew" | "member">;

export type CrewMemoryChange =
  | { readonly kind: "put"; readonly entry: CrewMemoryEntry }
  | { readonly kind: "delete"; readonly id: string }
  | { readonly kind: "none" };

export interface CrewMemoryContext {
  /** The open task's assignment, if any. */
  readonly assignment?: string;
  readonly now: string;
  /** The tree's head, for a fact's `verifiedAt`: later changes to its paths mark it stale. */
  readonly head?: string;
}

export interface CrewMemoryOutcome {
  readonly change: CrewMemoryChange;
  readonly answer: CrewToolText;
}

const INDEX_KINDS: ReadonlySet<CrewMemoryKind> = new Set(["decision", "lesson", "fact", "open"]);
const INDEX_ENTRIES_MAX = 30;
const INDEX_CHARS_MAX = 2_500;
const NOTES_MAX = 10;
const UNFILED_MAX = 5;
/** Per entry: an unfiled lesson is an index entry waiting to be filed. */
const TEXT_MAX: Readonly<Record<CrewMemoryKind, number>> = {
  decision: 200,
  lesson: 200,
  fact: 200,
  open: 200,
  unfiled: 200,
  note: 4_000,
  handoff: 2_000,
};

const count = (value: number): string => value.toLocaleString("en-US");

const answered = (text: string, change: CrewMemoryChange): CrewMemoryOutcome => ({
  change,
  answer: { text, isError: false },
});

const refused = (text: string): CrewMemoryOutcome => ({
  change: { kind: "none" },
  answer: { text, isError: true },
});

const INDEX_FULL = refused(
  `Your index is full (${INDEX_ENTRIES_MAX} entries or ${count(INDEX_CHARS_MAX)} characters): merge or remove an entry first.`,
);

const unknownEntry = (id: string) =>
  refused(`No entry ${id}: crew_memory list shows your entries.`);

const idNumber = (entry: CrewMemoryEntry): number => Number(entry.id.slice(1)) || 0;
const byId = (a: CrewMemoryEntry, b: CrewMemoryEntry): number => idNumber(a) - idNumber(b);

/** Past the highest id, not the count: a removal leaves a hole an id must not refill. */
const nextMemoryId = (entries: ReadonlyArray<CrewMemoryEntry>): string =>
  `m${Math.max(0, ...entries.map(idNumber)) + 1}`;

const tooLong = (kind: CrewMemoryKind, text: string): CrewMemoryOutcome | undefined =>
  text.length <= TEXT_MAX[kind]
    ? undefined
    : refused(
        `A${kind === "open" ? "n" : ""} ${kind} holds at most ${count(TEXT_MAX[kind])} characters; this one has ${count(text.length)}.`,
      );

/** Whether the index still holds `text` in place of the entry `replacing`. */
const indexHolds = (
  entries: ReadonlyArray<CrewMemoryEntry>,
  text: string,
  replacing?: string,
): boolean => {
  const kept = entries.filter((entry) => INDEX_KINDS.has(entry.kind) && entry.id !== replacing);
  const chars = kept.reduce((sum, entry) => sum + entry.text.length, text.length);
  return kept.length < INDEX_ENTRIES_MAX && chars <= INDEX_CHARS_MAX;
};

const add = (
  entries: ReadonlyArray<CrewMemoryEntry>,
  op: Extract<CrewMemoryOp, { readonly op: "add" }>,
  ctx: CrewMemoryContext,
): CrewMemoryOutcome => {
  const long = tooLong(op.kind, op.text);
  if (long) return long;
  const entry: CrewMemoryEntry = {
    id: nextMemoryId(entries),
    kind: op.kind,
    topic: op.topic,
    text: op.text,
    paths: op.paths ?? [],
    verifiedAt: op.kind === "fact" ? (ctx.head ?? null) : null,
    fromAssignment: ctx.assignment ?? null,
    updatedAt: ctx.now,
  };
  switch (op.kind) {
    case "note": {
      const notes = entries.filter((candidate) => candidate.kind === "note");
      const same = notes.find((candidate) => candidate.topic === op.topic);
      if (same) return refused(`A note on "${op.topic}" exists as ${same.id}: update it instead.`);
      if (notes.length >= NOTES_MAX) {
        return refused(`You have ${NOTES_MAX} notes: merge or remove one first.`);
      }
      break;
    }
    case "handoff": {
      if (ctx.assignment === undefined) {
        return refused("A handoff belongs to a task, and no task is open.");
      }
      const current = entries.find(
        (candidate) => candidate.kind === "handoff" && candidate.fromAssignment === ctx.assignment,
      );
      if (current) {
        return answered(`Replaced your handoff ${current.id}.`, {
          kind: "put",
          entry: { ...entry, id: current.id },
        });
      }
      break;
    }
    default:
      if (!indexHolds(entries, op.text)) return INDEX_FULL;
  }
  return answered(`Added ${entry.id}.`, { kind: "put", entry });
};

const label = (entry: CrewMemoryEntry, withTopic: boolean): string =>
  [entry.kind, ...(withTopic && entry.topic !== null ? [entry.topic] : []), ...entry.paths].join(
    " · ",
  );

/**
 * Without a topic: the index, the notes by topic (a note is read on demand),
 * handoffs and unfiled lessons. With one: that topic's entries, notes in full.
 */
const listed = (entries: ReadonlyArray<CrewMemoryEntry>, topic: string | undefined): string => {
  if (topic !== undefined) {
    const onTopic = entries.filter((entry) => entry.topic === topic);
    return onTopic.length === 0
      ? `Nothing on "${topic}".`
      : [
          `On ${topic}:`,
          ...onTopic.map((entry) => `- ${entry.id} [${label(entry, false)}] ${entry.text}`),
        ].join("\n");
  }
  if (entries.length === 0) return "Your memory is empty.";
  const index = entries.filter((entry) => INDEX_KINDS.has(entry.kind));
  const notes = entries.filter((entry) => entry.kind === "note");
  const handoffs = entries.filter((entry) => entry.kind === "handoff");
  const unfiled = entries.filter((entry) => entry.kind === "unfiled");
  return [
    ...(index.length === 0
      ? []
      : ["Index:", ...index.map((entry) => `- ${entry.id} [${label(entry, true)}] ${entry.text}`)]),
    ...(notes.length === 0
      ? []
      : [
          `Notes, read one with list and its topic: ${notes.map((note) => `${note.topic ?? ""} (${note.id})`).join(", ")}`,
        ]),
    ...handoffs.map((handoff) => `Handoff ${handoff.id}: ${handoff.text}`),
    ...(unfiled.length === 0
      ? []
      : [
          "Unfiled lessons, to file with add and then remove:",
          ...unfiled.map((lesson) => `- ${lesson.id} ${lesson.text}`),
        ]),
  ].join("\n");
};

/**
 * One `crew_memory` operation against the crewmate's entries, as at most one
 * row to write and the answer the model reads. Each write changes one entry;
 * nothing regenerates the whole memory.
 */
export const applyMemoryOp = (
  entries: ReadonlyArray<CrewMemoryEntry>,
  op: CrewMemoryOp,
  ctx: CrewMemoryContext,
): CrewMemoryOutcome => {
  switch (op.op) {
    case "add":
      return add(entries, op, ctx);
    case "update": {
      const current = entries.find((entry) => entry.id === op.id);
      if (!current) return unknownEntry(op.id);
      const long = tooLong(current.kind, op.text);
      if (long) return long;
      if (INDEX_KINDS.has(current.kind) && !indexHolds(entries, op.text, current.id)) {
        return INDEX_FULL;
      }
      return answered(`Updated ${current.id}.`, {
        kind: "put",
        entry: {
          ...current,
          text: op.text,
          verifiedAt: current.kind === "fact" ? (ctx.head ?? null) : current.verifiedAt,
          updatedAt: ctx.now,
        },
      });
    }
    case "remove":
      return entries.some((entry) => entry.id === op.id)
        ? answered(`Removed ${op.id}.`, { kind: "delete", id: op.id })
        : unknownEntry(op.id);
    case "list":
      return answered(listed(entries, op.topic), { kind: "none" });
  }
};

/**
 * `crew_report`'s lessons, queued as unfiled entries for the crewmate to
 * file; past five, the oldest go. Blank lessons are skipped and long ones cut.
 */
export const recordLessons = (
  entries: ReadonlyArray<CrewMemoryEntry>,
  lessons: ReadonlyArray<string>,
  ctx: CrewMemoryContext,
): ReadonlyArray<CrewMemoryChange> => {
  const added: Array<CrewMemoryEntry> = [];
  for (const lesson of lessons.map((text) => text.trim()).filter((text) => text !== "")) {
    added.push({
      id: nextMemoryId([...entries, ...added]),
      kind: "unfiled",
      topic: null,
      text:
        lesson.length <= TEXT_MAX.unfiled ? lesson : `${lesson.slice(0, TEXT_MAX.unfiled - 1)}…`,
      paths: [],
      verifiedAt: null,
      fromAssignment: ctx.assignment ?? null,
      updatedAt: ctx.now,
    });
  }
  const queue = [...entries.filter((entry) => entry.kind === "unfiled"), ...added].toSorted(byId);
  const dropped = queue.slice(0, Math.max(0, queue.length - UNFILED_MAX));
  const droppedIds = new Set(dropped.map((entry) => entry.id));
  return [
    ...added
      .filter((entry) => !droppedIds.has(entry.id))
      .map((entry): CrewMemoryChange => ({ kind: "put", entry })),
    ...dropped
      .filter((entry) => !added.includes(entry))
      .map((entry): CrewMemoryChange => ({ kind: "delete", id: entry.id })),
  ];
};

/**
 * The state packet's input from the crewmate's memory: the index with its
 * `stale?` marks, the open task's handoff, and the unfiled lessons oldest
 * first. Notes stay out; they are read on demand.
 */
export const crewPacketInput = (input: {
  readonly seq: number;
  readonly task: PacketTask | undefined;
  /** The open task's assignment, whose handoff the packet carries. */
  readonly assignment: string | undefined;
  readonly ground: PacketGround;
  readonly entries: ReadonlyArray<CrewMemoryEntry>;
  /** Facts whose paths changed on the tree since they were verified. */
  readonly stale: ReadonlySet<string>;
}): PacketInput => ({
  seq: input.seq,
  task: input.task,
  ground: input.ground,
  handoff:
    input.assignment === undefined
      ? undefined
      : input.entries.find(
          (entry) => entry.kind === "handoff" && entry.fromAssignment === input.assignment,
        )?.text,
  index: input.entries
    .filter((entry) => INDEX_KINDS.has(entry.kind))
    .toSorted(byId)
    .map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      text: entry.text,
      stale: input.stale.has(entry.id),
    })),
  unfiled: input.entries
    .filter((entry) => entry.kind === "unfiled")
    .toSorted(byId)
    .map((entry) => ({ id: entry.id, text: entry.text })),
});

/** The `key<TAB>value` lines a crew script prints (CrewShell `fields`). */
type ScriptFields = ReadonlyArray<readonly [string, string]>;

const valuesOf = (fields: ScriptFields, key: string): ReadonlyArray<string> =>
  fields.filter(([name]) => name === key).map(([, value]) => value);

/**
 * Ground truth from the packet script's output: the copy's tip, status and
 * diffstat, plus the facts whose paths the tree changed since they were
 * verified. The last check and the resets are the engine's own records.
 */
export const groundFromFields = (
  fields: ScriptFields,
  known: {
    readonly lane: boolean;
    readonly lastCheck?: string;
    readonly resets: ReadonlyArray<string>;
  },
): { readonly ground: PacketGround; readonly stale: ReadonlySet<string> } => {
  const stale = new Set(valuesOf(fields, "stale"));
  if (!known.lane) {
    return { ground: { unavailable: "a read-only crewmate has no copy of the code" }, stale };
  }
  const [tip] = valuesOf(fields, "tip");
  if (tip === undefined) {
    const [reason = "the copy could not be read"] = valuesOf(fields, "unavailable");
    return { ground: { unavailable: reason }, stale };
  }
  return {
    ground: {
      tip,
      status: valuesOf(fields, "status"),
      diffstat: valuesOf(fields, "diffstat"),
      ...(known.lastCheck === undefined ? {} : { lastCheck: known.lastCheck }),
      resets: known.resets,
    },
    stale,
  };
};
