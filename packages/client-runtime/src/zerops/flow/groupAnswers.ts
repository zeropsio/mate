/**
 * Per-group retaining publication for the project flow (DESIGN §4.7, M3, M4, M8).
 *
 * The flow's two halves are read one group at a time, and each group is its
 * own fact: it is published the moment its read completes, a read that fails
 * keeps the group's last answer, and a group whose inputs change is read again
 * without touching its neighbours. A clock tick asks for every group again
 * after whatever is in flight — it never aborts a read, so a pass that takes
 * longer than the tick still publishes. A verb invalidates exactly the part of
 * one group it changed, and that read starts at once.
 *
 * Answers are accepted in the order their reads started: a read that started
 * before a newer one of the same group had its answer accepted is suppressed
 * (M2). Only `dispose` aborts — the owner is gone.
 *
 * A group whose reads fail says why, once, and takes it back when a whole
 * read answers: a failure beside a kept answer is not the same as a fresh
 * one, and a verb's read of one part proves nothing about the rest.
 *
 * UI-free and platform-free (rule R1): the owner supplies the reads and the clock.
 *
 * @module flow/groupAnswers
 */
import { mateDiagnostics } from "../diagnostics.ts";
import { zeropsErrorMessage } from "../errors.ts";

/**
 * What a completed read makes of the group's held answer. A read of one part
 * keeps the rest of what is held; `undefined` publishes nothing.
 */
export type GroupUpdate<Answer> = (held: Answer | undefined) => Answer | undefined;

export interface GroupAnswers<Group, Scope> {
  /** The groups to answer for. A group whose key changed is read again; the rest keep theirs. */
  readonly setGroups: (groups: ReadonlyArray<Group>) => void;
  /** Every group again, after whatever is in flight: the clock's re-read. */
  readonly refresh: () => void;
  /** One part of one group again, at once: what a verb changed. */
  readonly invalidate: (groupId: string, scope: Scope | "group") => void;
  /** The owner is gone: abort what is in flight and publish nothing more. */
  readonly dispose: () => void;
}

export function createGroupAnswers<Group, Scope, Answer>(options: {
  /** Which half of the flow this is, for the `flow-pass` diagnostic. */
  readonly pass: "forge" | "deploys";
  readonly idOf: (group: Group) => string;
  /** Everything a group's read depends on; a change reads that group again. */
  readonly keyOf: (group: Group) => string;
  /**
   * Rejects when the read failed: the group keeps what it had. `held` is the
   * group's answer when the read starts, for a read that keeps a part of it
   * that did not answer this time.
   */
  readonly read: (
    group: Group,
    scope: Scope | "group",
    signal: AbortSignal,
    held: Answer | undefined,
  ) => Promise<GroupUpdate<Answer>>;
  readonly publish: (groupId: string, answer: Answer) => void;
  readonly forget: (groupIds: ReadonlyArray<string>) => void;
  /** A group's reads started failing with `cause`, or a whole read answered again (`null`). */
  readonly failure: (groupId: string, cause: string | null) => void;
  /** What an earlier owner already published, kept until a read replaces it. */
  readonly initial?: ReadonlyMap<string, Answer>;
}): GroupAnswers<Group, Scope> {
  const controller = new AbortController();
  const held = new Map<string, { readonly ticket: number; readonly answer: Answer }>();
  for (const [groupId, answer] of options.initial ?? []) held.set(groupId, { ticket: 0, answer });
  const groups = new Map<string, Group>();
  const keys = new Map<string, string>();
  /** Why each failing group's latest read failed, and which read that was. */
  const failing = new Map<string, { readonly ticket: number; readonly cause: string }>();
  /** Groups owed a whole read, in the order they became due. */
  const due = new Set<string>();
  let tickets = 0;
  let draining = false;

  /** Reads one scope of one group and accepts its answer if nothing newer was accepted. */
  const readGroup = async (groupId: string, scope: Scope | "group"): Promise<boolean> => {
    const group = groups.get(groupId);
    if (group === undefined) return false;
    tickets += 1;
    const ticket = tickets;
    let update: GroupUpdate<Answer> | { readonly failed: string };
    try {
      update = await options.read(group, scope, controller.signal, held.get(groupId)?.answer);
    } catch (cause) {
      update = { failed: zeropsErrorMessage(cause) };
    }
    if (controller.signal.aborted || !groups.has(groupId)) return false;
    const previous = held.get(groupId);
    if (previous !== undefined && previous.ticket > ticket) return false;
    const failed = failing.get(groupId);
    if (typeof update !== "function") {
      if (failed !== undefined && failed.ticket > ticket) return false;
      failing.set(groupId, { ticket, cause: update.failed });
      if (failed?.cause !== update.failed) options.failure(groupId, update.failed);
      return false;
    }
    // A read that started before the failure, or read only a part, proves nothing about it.
    if (scope === "group" && failed !== undefined && failed.ticket < ticket) {
      failing.delete(groupId);
      options.failure(groupId, null);
    }
    const answer = update(previous?.answer);
    if (answer === undefined || answer === previous?.answer) return false;
    held.set(groupId, { ticket, answer });
    options.publish(groupId, answer);
    return true;
  };

  /** Reads every due group, one at a time; what becomes due meanwhile is read in the same run. */
  const drain = async () => {
    if (draining) return;
    draining = true;
    const span = mateDiagnostics.span("flow-pass", { pass: options.pass, groups: due.size });
    let answered = 0;
    try {
      for (let groupId = first(due); groupId !== undefined; groupId = first(due)) {
        if (controller.signal.aborted) break;
        due.delete(groupId);
        if (await readGroup(groupId, "group")) answered += 1;
      }
    } finally {
      draining = false;
      if (controller.signal.aborted) span.drop();
      else span.end({ answered });
    }
  };

  const schedule = (groupIds: Iterable<string>) => {
    if (controller.signal.aborted) return;
    for (const groupId of groupIds) due.add(groupId);
    if (due.size > 0) void drain();
  };

  return {
    setGroups: (next) => {
      const byId = new Map(next.map((group) => [options.idOf(group), group] as const));
      const left = [...groups.keys(), ...held.keys()].filter((groupId) => !byId.has(groupId));
      for (const groupId of left) {
        groups.delete(groupId);
        keys.delete(groupId);
        held.delete(groupId);
        failing.delete(groupId);
        due.delete(groupId);
      }
      if (left.length > 0) options.forget([...new Set(left)]);
      const changed: string[] = [];
      for (const [groupId, group] of byId) {
        groups.set(groupId, group);
        const key = options.keyOf(group);
        if (keys.get(groupId) === key) continue;
        keys.set(groupId, key);
        changed.push(groupId);
      }
      schedule(changed);
    },
    refresh: () => {
      schedule(groups.keys());
    },
    invalidate: (groupId, scope) => {
      if (controller.signal.aborted) return;
      void readGroup(groupId, scope);
    },
    dispose: () => {
      controller.abort();
      due.clear();
    },
  };
}

const first = (set: ReadonlySet<string>): string | undefined => set.values().next().value;
