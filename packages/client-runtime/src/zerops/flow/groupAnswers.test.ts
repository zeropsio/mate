import { describe, expect, it } from "vite-plus/test";

import { createGroupAnswers, type GroupUpdate } from "./groupAnswers.ts";

interface Group {
  readonly groupId: string;
  readonly key: string;
}

interface Answer {
  readonly rows: ReadonlyArray<string>;
}

type Scope = { readonly kind: "repository"; readonly repository: string };

/** A read the test settles by hand, in any order. */
interface PendingRead {
  readonly groupId: string;
  readonly scope: Scope | "group";
  readonly signal: AbortSignal;
  readonly held: Answer | undefined;
  readonly resolve: (update: GroupUpdate<Answer>) => void;
  readonly reject: (cause: unknown) => void;
}

function harness(initial?: ReadonlyMap<string, Answer>) {
  const reads: PendingRead[] = [];
  const published: Array<{ readonly groupId: string; readonly answer: Answer }> = [];
  const forgotten: string[] = [];
  const failures: Array<{ readonly groupId: string; readonly cause: string | null }> = [];
  const answers = createGroupAnswers<Group, Scope, Answer>({
    pass: "forge",
    idOf: (group) => group.groupId,
    keyOf: (group) => group.key,
    read: (group, scope, signal, held) =>
      new Promise((resolve, reject) => {
        reads.push({ groupId: group.groupId, scope, signal, held, resolve, reject });
      }),
    publish: (groupId, answer) => {
      published.push({ groupId, answer });
    },
    forget: (groupIds) => {
      forgotten.push(...groupIds);
    },
    failure: (groupId, cause) => {
      failures.push({ groupId, cause });
    },
    ...(initial === undefined ? {} : { initial }),
  });
  const settle = async () => {
    for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
  };
  /** The oldest read of a group still waiting to be settled. */
  const next = (groupId: string) => {
    const index = reads.findIndex((read) => read.groupId === groupId);
    if (index < 0) throw new Error(`no read of ${groupId} is waiting`);
    return reads.splice(index, 1)[0]!;
  };
  return { answers, reads, published, forgotten, failures, settle, next };
}

const answer = (...rows: string[]): Answer => ({ rows });
const G1: Group = { groupId: "g1", key: "g1@1" };
const G2: Group = { groupId: "g2", key: "g2@1" };

describe("createGroupAnswers", () => {
  it("G2 resolving leaves G1's stops", async () => {
    const { answers, published, settle, next } = harness();
    answers.setGroups([G1, G2]);
    next("g1").resolve(() => answer("g1 stage"));
    await settle();
    next("g2").resolve(() => answer("g2 stage"));
    await settle();
    // Each group is published on its own as it completes; G2's answer is one
    // publication of G2 and nothing of G1 is published again.
    expect(published.map((entry) => entry.groupId)).toEqual(["g1", "g2"]);
    expect(published[1]!.answer).toEqual(answer("g2 stage"));
  });

  it("a failed read keeps the group's last answer", async () => {
    const { answers, published, settle, next } = harness();
    answers.setGroups([G1]);
    next("g1").resolve(() => answer("#4"));
    await settle();
    answers.refresh();
    next("g1").reject(new Error("Gitea did not answer"));
    await settle();
    expect(published).toEqual([{ groupId: "g1", answer: answer("#4") }]);
    // The next read still starts from what was kept.
    answers.refresh();
    let seen: Answer | undefined;
    next("g1").resolve((held) => {
      seen = held;
      return held;
    });
    await settle();
    expect(seen).toEqual(answer("#4"));
  });

  it("says why a group's reads fail, once, and takes it back when one answers", async () => {
    const { answers, failures, settle, next } = harness();
    answers.setGroups([G1, G2]);
    next("g1").reject(new Error("Gitea did not answer"));
    await settle();
    next("g2").resolve(() => answer("g2"));
    await settle();
    answers.refresh();
    next("g1").reject(new Error("Gitea did not answer"));
    await settle();
    // Failing again the same way is not news; the neighbour never failed.
    expect(failures).toEqual([{ groupId: "g1", cause: "Gitea did not answer" }]);
    next("g2").resolve(() => answer("g2"));
    await settle();
    answers.refresh();
    // An answer that changes nothing still ends the failure.
    next("g1").resolve(() => undefined);
    await settle();
    expect(failures.at(-1)).toEqual({ groupId: "g1", cause: null });
  });

  it("a pass longer than 60 s still publishes", async () => {
    const { answers, reads, published, settle, next } = harness();
    answers.setGroups([G1, G2]);
    const slow = next("g1");
    // Two clock ticks while the first group is still being read: neither
    // aborts it, and neither starts a second read of anything beside it.
    answers.refresh();
    answers.refresh();
    expect(slow.signal.aborted).toBe(false);
    expect(reads).toHaveLength(0);
    slow.resolve(() => answer("g1 stage"));
    await settle();
    expect(published.map((entry) => entry.groupId)).toEqual(["g1"]);
    next("g2").resolve(() => answer("g2 stage"));
    await settle();
    expect(published.map((entry) => entry.groupId)).toEqual(["g1", "g2"]);
    // The ticks are owed once each group is done: one more read of G1, which
    // was read before they arrived; G2 was already due, so it is read once.
    next("g1").resolve(() => answer("g1 stage, again"));
    await settle();
    expect(reads).toHaveLength(0);
  });

  it("reads again only the group whose key changed; its neighbours keep their answers", async () => {
    const { answers, reads, published, settle, next } = harness();
    answers.setGroups([G1, G2]);
    next("g1").resolve(() => answer("g1"));
    await settle();
    next("g2").resolve(() => answer("g2"));
    await settle();
    // G1's projects resolve: a new key is a new fact for G1 alone.
    answers.setGroups([{ ...G1, key: "g1@2" }, G2]);
    expect(reads.map((read) => read.groupId)).toEqual(["g1"]);
    next("g1").resolve(() => answer("g1, resolved"));
    await settle();
    expect(published.map((entry) => entry.groupId)).toEqual(["g1", "g2", "g1"]);
    expect(reads).toHaveLength(0);
  });

  it("an invalidation reads its one scope at once, beside a pass in flight", async () => {
    const { answers, reads, published, settle, next } = harness();
    answers.setGroups([G1, G2]);
    next("g1").resolve(() => answer("appdev #4", "apidev #7"));
    await settle();
    const pass = next("g2");
    answers.invalidate("g1", { kind: "repository", repository: "appdev" });
    expect(reads.map((read) => [read.groupId, read.scope])).toEqual([
      ["g1", { kind: "repository", repository: "appdev" }],
    ]);
    next("g1").resolve((held) => ({
      rows: (held?.rows ?? []).filter((row) => !row.startsWith("appdev")),
    }));
    await settle();
    expect(published.at(-1)).toEqual({ groupId: "g1", answer: answer("apidev #7") });
    expect(pass.signal.aborted).toBe(false);
  });

  it("accepts a group's answers in the order their reads started, never older over newer", async () => {
    const { answers, published, settle, next } = harness();
    answers.setGroups([G1]);
    const older = next("g1");
    answers.invalidate("g1", "group");
    const newer = next("g1");
    newer.resolve(() => answer("after the merge"));
    await settle();
    // The read that started before the merge answers last; its value is suppressed.
    older.resolve(() => answer("before the merge"));
    await settle();
    expect(published).toEqual([{ groupId: "g1", answer: answer("after the merge") }]);
  });

  it("keeps the answers it was handed, and forgets a group that left", async () => {
    const { answers, forgotten, settle, next } = harness(new Map([["g2", answer("kept")]]));
    answers.setGroups([G1, G2]);
    next("g1").resolve(() => answer("g1"));
    await settle();
    let held: Answer | undefined;
    next("g2").resolve((previous) => {
      held = previous;
      return previous;
    });
    await settle();
    expect(held).toEqual(answer("kept"));
    answers.setGroups([G1]);
    expect(forgotten).toEqual(["g2"]);
  });

  it("hands a group's read the answer it holds when the read starts", async () => {
    const { answers, settle, next } = harness();
    answers.setGroups([G1]);
    const first = next("g1");
    expect(first.held).toBeUndefined();
    first.resolve(() => answer("g1"));
    await settle();
    answers.refresh();
    expect(next("g1").held).toEqual(answer("g1"));
  });

  it("aborts what is in flight and publishes nothing once disposed", async () => {
    const { answers, published, settle, next } = harness();
    answers.setGroups([G1]);
    const read = next("g1");
    answers.dispose();
    expect(read.signal.aborted).toBe(true);
    read.resolve(() => answer("late"));
    await settle();
    expect(published).toEqual([]);
  });
});
