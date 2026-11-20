import { expect, it } from "vite-plus/test";

import { type BirthFacts, type BirthProcessFact, deriveBirthProgress } from "./birthProgress.ts";

const process = (
  actionName: string,
  status: BirthProcessFact["status"],
  createdAt: string,
): BirthProcessFact => ({
  actionName,
  status,
  createdAt,
  startedAt: createdAt,
  finishedAt: status === "RUNNING" ? null : createdAt,
  serviceIds: ["s1"],
});

const states = (facts: BirthFacts): ReadonlyArray<string> =>
  deriveBirthProgress(facts, 0).steps.map((step) => step.state);

// witness: packages/client-runtime/src/zerops/birthProgress.ts | return [...processes].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]; → return [...processes].sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0];
it("ZV131: A Mate's birth shows at most one active step; a finished step completes the earlier ones; a newer process replaces an older failure whatever order they arrive in", () => {
  const backfilled: BirthFacts = {
    project: { status: "CREATING" },
    container: { serviceId: "s1", status: "ACTIVE", hasOrigin: false },
    processes: [],
    health: undefined,
    connection: "none",
  };
  expect(states(backfilled)).toEqual(["done", "done", "active", "waiting", "waiting"]);

  const failedCreate = process("stack.create", "FAILED", "2026-01-01T10:00:00.000Z");
  const retriedBuild = process("stack.build", "RUNNING", "2026-01-01T10:05:00.000Z");
  for (const processes of [
    [failedCreate, retriedBuild],
    [retriedBuild, failedCreate],
  ]) {
    const facts: BirthFacts = {
      project: { status: "ACTIVE" },
      container: { serviceId: "s1", status: "CREATING", hasOrigin: false },
      processes,
      health: undefined,
      connection: "none",
    };
    expect(states(facts)).toEqual(["done", "active", "waiting", "waiting", "waiting"]);
    expect(deriveBirthProgress(facts, 0).failed).toBeNull();
  }
});
