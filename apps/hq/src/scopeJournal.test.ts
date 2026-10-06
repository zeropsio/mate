import { describe, expect, it } from "@effect/vitest";
import { makeScopeJournal } from "./scopeJournal.ts";

const scope = { kind: "navigation" } as const;
describe("scope revision journal", () => {
  it("resumes an unchanged segment without data and replays only later values", () => {
    const journal = makeScopeJournal(scope, "core-1", 2);
    journal.commit([{ key: "app:a", value: { name: "A" } }]);
    const first = journal.resume();
    expect(first[0]).toMatchObject({ type: "scope-reset", revision: 1 });
    const cursor = { incarnation: "core-1", revision: 1 };
    expect(journal.resume(cursor)).toEqual([]);
    journal.commit([{ key: "app:a", value: { name: "B" } }]);
    expect(journal.resume(cursor)).toEqual([
      {
        type: "scope-values",
        scope,
        incarnation: "core-1",
        revision: 2,
        values: [{ key: "app:a", value: { name: "B" } }],
        removals: [],
      },
    ]);
  });
  it("a source baseline rotates only this journal and cannot replay its retired source", () => {
    const journal = makeScopeJournal({ kind: "attention", projectId: "P" }, "core");
    journal.commit([{ key: "P", value: { source: "old", revision: 7 } }]);
    const baseline = journal.commit(
      [{ key: "P", value: { source: "new", revision: 0 } }],
      [],
      true,
    )!;
    expect(baseline.type).toBe("scope-reset");
    expect(baseline.incarnation).not.toBe("core");
    expect(journal.resume({ incarnation: "core", revision: 0 })).toEqual([baseline]);
    expect(
      journal.resume({ incarnation: baseline.incarnation, revision: baseline.revision }),
    ).toEqual([]);
  });
  it("omission leaves values intact; explicit removal preserves its reason on reset", () => {
    const journal = makeScopeJournal(scope, "core-1", 1);
    journal.commit([
      { key: "a", value: 1 },
      { key: "b", value: 2 },
    ]);
    journal.commit([{ key: "a", value: 3 }]);
    expect(journal.resume()[0]?.values).toEqual([
      { key: "a", value: 3 },
      { key: "b", value: 2 },
    ]);
    journal.commit([], [{ key: "b", reason: "no-access" }]);
    expect(journal.resume({ incarnation: "old", revision: 1 })[0]).toMatchObject({
      type: "scope-reset",
      removals: [{ key: "b", reason: "no-access" }],
    });
  });
  it("resets only this scope when replay retention is exhausted", () => {
    const journal = makeScopeJournal(scope, "core-1", 1);
    journal.commit([{ key: "a", value: 1 }]);
    journal.commit([{ key: "a", value: 2 }]);
    journal.commit([{ key: "a", value: 3 }]);
    expect(journal.resume({ incarnation: "core-1", revision: 1 })[0]?.type).toBe("scope-reset");
    expect(journal.resume({ incarnation: "core-1", revision: 2 })[0]?.type).toBe("scope-values");
    expect(journal.resume({ incarnation: "core-1", revision: 100 })[0]?.type).toBe("scope-reset");
  });
  it("unchanged values do not create a revision", () => {
    const journal = makeScopeJournal(scope, "core-1", 2);
    expect(journal.commit([{ key: "a", value: { n: 1 } }])?.revision).toBe(1);
    expect(journal.commit([{ key: "a", value: { n: 1 } }])).toBeUndefined();
  });
  it("does not replay protected historical values after access is revoked", () => {
    const journal = makeScopeJournal(scope, "core-1", 3);
    journal.commit([{ key: "private", value: "secret" }]);
    journal.commit([], [{ key: "private", reason: "no-access" }]);
    const replay = journal.resume({ incarnation: "core-1", revision: 0 });
    expect(replay).toHaveLength(1);
    expect(replay[0]).toMatchObject({
      type: "scope-reset",
      values: [],
      removals: [{ key: "private", reason: "no-access" }],
    });
  });

  it("bounds removed keys and rotates only this scope when old proof is discarded", () => {
    const journal = makeScopeJournal(scope, "core-1", 2, 2);
    journal.commit([], [{ key: "a", reason: "deleted" }]);
    journal.commit([], [{ key: "b", reason: "deleted" }]);
    journal.commit([], [{ key: "c", reason: "deleted" }]);
    const reset = journal.resume({ incarnation: "core-1", revision: 1 })[0]!;
    expect(reset.type).toBe("scope-reset");
    expect(reset.incarnation).not.toBe("core-1");
    expect(reset.removals).toHaveLength(2);
  });
  it("a rotation explicitly removes every live key from the committing client", () => {
    const journal = makeScopeJournal(scope, "core-1", 2, 2);
    journal.commit(["a", "b", "c"].map((key) => ({ key, value: key })));
    const removed = ["a", "b", "c"].map((key) => ({ key, reason: "deleted" as const }));
    const message = journal.commit([], removed)!;
    expect(message.type).toBe("scope-reset");
    expect(message.removals).toEqual(expect.arrayContaining(removed));
    expect(message.removals).toHaveLength(3);
  });
});
