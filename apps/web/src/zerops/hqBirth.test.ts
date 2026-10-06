import { HQ_BIRTH_START, type HqBirthOutcome } from "@t3tools/client-runtime/zerops/hq";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { closeAccountLifetime, openAccountLifetime } from "./accountLifetime";
import { bearHq, hqBirthView, useHqBirths } from "./hqBirth";

const BORN: HqBirthOutcome = { ok: true, hq: { projectId: "hq1", address: "https://hq.example" } };
const stopped: HqBirthOutcome = {
  ok: false,
  step: "deploy",
  reason: "Insufficient credit",
  uncertain: false,
};

describe("HQ gate birth", () => {
  beforeEach(() => {
    openAccountLifetime("ada");
    useHqBirths.setState({ byOrg: {} });
  });
  afterEach(() => {
    closeAccountLifetime();
    vi.unstubAllGlobals();
  });
  const held = () => useHqBirths.getState().byOrg["org-1"];

  it("starts automatically without authorizing a retry of a recorded failure", async () => {
    const run = vi.fn(async () => stopped);
    bearHq({ clientId: "org-1", run, alreadyBorn: async () => false, onBorn: () => {} });
    await vi.waitFor(() => expect(held()?.running).toBe(false));
    expect(run).toHaveBeenCalledWith(HQ_BIRTH_START, expect.any(Function), false);
  });

  it("manual Again authorizes continuing the recorded step, and a successful birth rereads HQ", async () => {
    const onBorn = vi.fn();
    const run = vi.fn(async () => BORN);
    bearHq({ clientId: "org-1", run, alreadyBorn: async () => false, onBorn, again: true });
    await vi.waitFor(() => expect(onBorn).toHaveBeenCalledOnce());
    expect(run).toHaveBeenCalledWith(HQ_BIRTH_START, expect.any(Function), true);
    expect(held()?.record.step).toBe("done");
  });

  it("ends as done and rereads when another admin already created HQ", async () => {
    const run = vi.fn(async () => BORN);
    const onBorn = vi.fn();
    bearHq({ clientId: "org-1", run, alreadyBorn: async () => true, onBorn });
    await vi.waitFor(() => expect(onBorn).toHaveBeenCalledOnce());
    expect(held()?.record.step).toBe("done");
    expect(held()?.running).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("the project's journal is authority; the gate never reads or writes browser storage", async () => {
    const getItem = vi.fn(() => null);
    const setItem = vi.fn();
    vi.stubGlobal("window", { localStorage: { getItem, setItem, removeItem: vi.fn() } });
    bearHq({
      clientId: "org-1",
      run: async () => stopped,
      alreadyBorn: async () => false,
      onBorn: () => {},
    });
    await vi.waitFor(() => expect(held()?.running).toBe(false));
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  });

  it("an uncertain stop only offers checking the same birth again", async () => {
    bearHq({
      clientId: "org-1",
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
});
