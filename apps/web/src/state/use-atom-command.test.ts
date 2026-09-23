/**
 * `useAtomCommand` run as a plain function against `reactHookHarness`: the account's capability is
 * asked before a command runs, and a refusal comes back typed instead of as a silent interrupt.
 */
import {
  DEFAULT_ZEROPS_GRANT_POLICY,
  grantRoundInFlight,
  initialGrant,
  transitionGrant,
  type AccessGrantView,
  type ManagedZeropsDataRuntime,
} from "@t3tools/client-runtime/zerops/data";
import { AsyncResult, AtomRegistry } from "effect/unstable/reactivity";
import * as Cause from "effect/Cause";
import * as Stream from "effect/Stream";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { tabClock } from "../zerops/tabClock";

import type { AtomCommand } from "@t3tools/client-runtime/state/runtime";
import { closeAccountLifetime, openAccountLifetime } from "../zerops/accountLifetime";
import type { ZeropsDataContextValue } from "../zerops/zeropsDataContext";

/** What each context holds for the hook under test; set once the contexts are loaded. */
const contexts = vi.hoisted(() => ({
  read: (_context: unknown): unknown => undefined,
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { reactHookHarness: harness } = await import("../test/reactHookHarness");
  return {
    ...actual,
    useCallback: harness.useCallback,
    useMemo: harness.useMemo,
    useContext: (context: unknown) => contexts.read(context),
  };
});

const { RegistryContext } = await import("@effect/atom-react");
const { ZeropsDataContext } = await import("../zerops/zeropsDataContext");
const { reactHookHarness } = await import("../test/reactHookHarness");
const { useAtomCommand } = await import("./use-atom-command");

/** The registry and the account's data context the hook reads. */
const provide = (data: ZeropsDataContextValue | null) => {
  const registry = AtomRegistry.make();
  contexts.read = (context) =>
    context === RegistryContext ? registry : context === ZeropsDataContext ? data : undefined;
};

/** The account runtime's data context over a grant that stays at `view`. */
const dataOver = (view: AccessGrantView): ZeropsDataContextValue =>
  ({
    runtime: {
      access: { changes: Stream.make(view), clock: tabClock },
    } as unknown as ManagedZeropsDataRuntime,
    organizationRef: () => {
      throw new Error("unused");
    },
    projectRef: () => {
      throw new Error("unused");
    },
  }) as ZeropsDataContextValue;

const closedView: AccessGrantView = {
  machine: {
    ...initialGrant({ hidden: false, online: true }, { wall: 0, mono: 0 }),
    phase: { phase: "closed" },
  },
  failure: null,
  overdue: false,
};

/** A grant whose first round was admitted just now, on the clock the hook reads. */
const grantedNow = (): AccessGrantView => {
  const ctx = () => ({
    now: {
      wall: tabClock.currentTimeMillisUnsafe(),
      mono: Number(tabClock.monotonicTimeNanosUnsafe()) / 1_000_000,
    },
    policy: DEFAULT_ZEROPS_GRANT_POLICY,
  });
  let machine = initialGrant({ hidden: false, online: true }, ctx().now);
  machine = transitionGrant(machine, { type: "START" }, ctx()).state;
  machine = transitionGrant(
    machine,
    {
      type: "ROUND_ACCOUNT",
      round: grantRoundInFlight(machine)!.id,
      organizations: [],
      projects: [],
    },
    ctx(),
  ).state;
  return { machine, failure: null, overdue: false };
};

afterEach(() => {
  closeAccountLifetime();
  reactHookHarness.reset();
});

describe("useAtomCommand", () => {
  it("returns the typed refusal of a capability nothing can change, and runs nothing", async () => {
    openAccountLifetime("account-1");
    provide(dataOver(closedView));
    const run = vi.fn(async () => AsyncResult.success("done"));
    const command: AtomCommand<string, string, never> = { label: "send", run };

    reactHookHarness.beginRender();
    const result = await useAtomCommand(command)("hello");

    expect(run).not.toHaveBeenCalled();
    expect(result._tag).toBe("Failure");
    expect(result._tag === "Failure" && result.cause.reasons).toMatchObject([
      {
        _tag: "Fail",
        error: {
          _tag: "CapabilityRefusal",
          reason: "epoch-closed",
          waitable: false,
          message: "This Zerops sign-in has ended.",
        },
      },
    ]);
  });

  it("refuses a command asked with no account runtime as a sign-in that ended", async () => {
    openAccountLifetime("account-1");
    provide(null);
    const run = vi.fn(async () => AsyncResult.success("done"));

    reactHookHarness.beginRender();
    const result = await useAtomCommand({ label: "send", run })("hello");

    expect(run).not.toHaveBeenCalled();
    expect(result._tag === "Failure" && Cause.squash(result.cause)).toMatchObject({
      _tag: "CapabilityRefusal",
      reason: "epoch-closed",
    });
  });

  it("interrupts a command asked once its account closed, and runs nothing", async () => {
    provide(dataOver(grantedNow()));
    const run = vi.fn(async () => AsyncResult.success("done"));

    reactHookHarness.beginRender();
    const result = await useAtomCommand({ label: "send", run })("hello");

    expect(run).not.toHaveBeenCalled();
    expect(result._tag === "Failure" && Cause.hasInterruptsOnly(result.cause)).toBe(true);
  });

  it("runs a command the account's own evidence admits", async () => {
    openAccountLifetime("account-1");
    provide(dataOver(grantedNow()));
    const run = vi.fn(async () => AsyncResult.success("done"));

    reactHookHarness.beginRender();
    const result = await useAtomCommand({ label: "send", run })("hello");

    expect(run).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ _tag: "Success", value: "done" });
  });
});
