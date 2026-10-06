import { HQ_BIRTH_START, type HqBirthOutcome } from "@t3tools/client-runtime/zerops/hq";
import { AtomRegistry } from "effect/unstable/reactivity";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { closeAccountLifetime, openAccountLifetime } from "./accountLifetime";
import { bearHq, hqBirthAtom, hqBirthView } from "./hqBirth";

const BORN: HqBirthOutcome = { ok: true, hq: { projectId: "hq1", address: "https://hq.example" } };
const stopped: HqBirthOutcome = {
  ok: false,
  step: "deploy",
  reason: "Insufficient credit",
  uncertain: false,
};

describe("HQ gate birth", () => {
  let registry = AtomRegistry.make();
  beforeEach(() => {
    openAccountLifetime("ada");
    registry = AtomRegistry.make();
  });
  afterEach(() => {
    closeAccountLifetime();
    vi.unstubAllGlobals();
  });
  const held = () => registry.get(hqBirthAtom("org-1"));
  const bear = (input: Omit<Parameters<typeof bearHq>[0], "registry" | "clientId">) =>
    bearHq({ registry, clientId: "org-1", ...input });

  it("starts automatically without authorizing a retry of a recorded failure", async () => {
    const run = vi.fn(async () => stopped);
    bear({ run, alreadyBorn: async () => false, onBorn: () => {} });
    await vi.waitFor(() => expect(held()?.running).toBe(false));
    expect(run).toHaveBeenCalledWith(HQ_BIRTH_START, expect.any(Function), false);
  });

  it("manual Again authorizes continuing the recorded step, and a successful birth rereads HQ", async () => {
    const onBorn = vi.fn();
    const run = vi.fn(async () => BORN);
    bear({ run, alreadyBorn: async () => false, onBorn, again: true });
    await vi.waitFor(() => expect(onBorn).toHaveBeenCalledOnce());
    expect(run).toHaveBeenCalledWith(HQ_BIRTH_START, expect.any(Function), true);
    expect(held()?.record.step).toBe("done");
  });

  it("an HQ the member list names already is read again, and nothing is born", async () => {
    const onBorn = vi.fn();
    const run = vi.fn(async () => BORN);
    bear({ run, alreadyBorn: async () => true, onBorn });
    await vi.waitFor(() => expect(onBorn).toHaveBeenCalledOnce());
    expect(run).not.toHaveBeenCalled();
  });

  it("the project's journal is authority; the gate never reads or writes browser storage", async () => {
    const getItem = vi.fn(() => null);
    const setItem = vi.fn();
    vi.stubGlobal("window", { localStorage: { getItem, setItem, removeItem: vi.fn() } });
    bear({ run: async () => stopped, alreadyBorn: async () => false, onBorn: () => {} });
    await vi.waitFor(() => expect(held()?.running).toBe(false));
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  });

  it("an uncertain stop only offers checking the same birth again", async () => {
    bear({
      run: async () => ({ ...stopped, uncertain: true }),
      alreadyBorn: async () => false,
      onBorn: () => {},
    });
    await vi.waitFor(() => expect(held()?.running).toBe(false));
    expect(hqBirthView(held())).toEqual({
      kind: "failed",
      step: "deploy",
      reason: "Insufficient credit",
    });
  });

  it("a birth of an account that closed shows nothing more", async () => {
    let finish: (outcome: HqBirthOutcome) => void = () => {};
    bear({
      run: () => new Promise((resolve) => (finish = resolve)),
      alreadyBorn: async () => false,
      onBorn: () => {},
    });
    await vi.waitFor(() => expect(held()?.running).toBe(true));
    closeAccountLifetime();
    finish(stopped);
    await Promise.resolve();
    expect(held()?.running).toBe(true);
  });
});
