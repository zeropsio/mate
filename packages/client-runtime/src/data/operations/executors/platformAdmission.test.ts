import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { AtomRegistry } from "effect/unstable/reactivity";
import { makeAccountStore } from "../../store.ts";
import { liveProjects } from "../../__fixtures__/account.ts";
import { admitPlatformOperation } from "./platformAdmission.ts";
import type { OperationIntent } from "../../model.ts";

const viewer = { id: "org", name: "Org", membershipId: "member", roleCode: "ADMIN" };
describe("operation admission from the account store", () => {
  it.effect.each([
    {
      name: "a known project",
      listed: true,
      active: true,
      denied: false,
      role: "ADMIN",
      allowed: true,
      reads: 0,
    },
    {
      name: "an outage retains access",
      listed: true,
      active: true,
      denied: false,
      role: "ADMIN",
      allowed: true,
      reads: 0,
      outage: true,
    },
    {
      name: "unknown coverage",
      listed: false,
      active: true,
      denied: false,
      role: "ADMIN",
      allowed: false,
      reads: 1,
    },
    {
      name: "an authoritative denial",
      listed: true,
      active: true,
      denied: true,
      role: "ADMIN",
      allowed: false,
      reads: 0,
    },
    {
      name: "a reader cannot write",
      listed: true,
      active: true,
      denied: false,
      role: "READ_ONLY",
      allowed: false,
      reads: 0,
    },
    {
      name: "the account closed",
      listed: true,
      active: false,
      denied: false,
      role: "ADMIN",
      allowed: false,
      reads: 0,
    },
  ])("$name", (entry) =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      if (entry.listed)
        for (const input of liveProjects("org", [{ id: "p" }])) store.dispatch(input);
      if (entry.denied)
        store.dispatch({ kind: "access", family: "project", id: "p", access: "denied" });
      if (entry.outage)
        store.dispatch({
          kind: "stream",
          key: "zerops:org",
          now: 0,
          event: { kind: "fault", jitter: 0, fault: { outcome: "transient", message: "Offline" } },
        });
      let reads = 0;
      const intent: OperationIntent = { kind: "start-project", orgId: "org", projectId: "p" };
      const result = yield* Effect.result(
        admitPlatformOperation({
          intent,
          store,
          viewer: { ...viewer, roleCode: entry.role },
          active: () => entry.active,
          readDetail: async (demand) => {
            expect(demand).toEqual({ family: "project", listing: "project", ownerId: "p" });
            reads++;
            return false;
          },
        }),
      );
      expect(Result.isSuccess(result)).toBe(entry.allowed);
      if (Result.isFailure(result)) expect(result.failure.outcome).toBe("definitive-refusal");
      expect(reads).toBe(entry.reads);
    }),
  );
  it.effect("rechecks the account after an awaited access read", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      let active = true;
      const result = yield* Effect.result(
        admitPlatformOperation({
          intent: { kind: "start-project", orgId: "org", projectId: "p" },
          store,
          viewer,
          active: () => active,
          readDetail: async () => {
            for (const input of liveProjects("org", [{ id: "p" }])) store.dispatch(input);
            active = false;
            return true;
          },
        }),
      );
      expect(Result.isFailure(result)).toBe(true);
    }),
  );
});
