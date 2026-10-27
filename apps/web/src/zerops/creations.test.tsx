// @vitest-environment happy-dom
import { act, createElement as h, useEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { closeAccountLifetime, openAccountLifetime } from "./accountLifetime";
import {
  beginCreation,
  dismissCreation,
  runOnce,
  startAddOver,
  tryCreationAgain,
  useCreations,
} from "./creations";
import { useNewMateDialog } from "./newMate";
import type { CreationAsk, NewProjectAsk, NewProjectBirth } from "./newProjectBirth";

const HQ = { projectId: "hq-1", address: "https://hq.example" } as const;
const ACME: NewProjectAsk = {
  organizationId: "org-acme",
  birthId: "b-acme",
  name: "Acme CRM",
  botName: "Vera",
  face: { tint: "rose", shape: "seal" },
  locationId: null,
  agents: [],
};
const IDA: NewProjectAsk = {
  ...ACME,
  birthId: "add-1",
  botName: "Ida",
  adds: { appId: "app-acme", registers: true },
};

/** Every creation this tab holds, as its surfaces draw them, read through the hook. */
let drawn: ReadonlyArray<NewProjectBirth> = [];
function Probe() {
  const creations = useCreations();
  useEffect(() => {
    drawn = creations;
  }, [creations]);
  return null;
}
let renderer: ReactTestRenderer | undefined;
const mount = () => {
  act(() => {
    renderer = create(h(Probe));
  });
};

/** A creation as its view draws it, once a step stopped it. */
const stoppedAs = (ask: NewProjectAsk, uncertain: boolean): NewProjectBirth => ({
  ...ask,
  startedAt: 0,
  hq: HQ,
  appId: ask.adds?.appId ?? null,
  intent: null,
  step: "create",
  failed: { reason: "No room.", uncertain },
  projectId: null,
});

beforeEach(() => {
  openAccountLifetime("u-ada");
  useNewMateDialog.setState({ asked: null });
});
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  closeAccountLifetime();
});

describe("the creations this tab holds", () => {
  it("holds each ask from the press and runs it, drawn before anything is recorded", () => {
    const run = vi.fn();
    beginCreation({ ask: ACME, hq: HQ, now: 5, run });
    mount();
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ ask: ACME, startedAt: 5, presses: 1, refusedHere: null }),
    );
    expect(drawn).toEqual([
      expect.objectContaining({ birthId: "b-acme", step: "registry", failed: null }),
    ]);
  });

  it("tries a New project again under the same ask, and an Add pressed whole again", () => {
    const runs: Array<CreationAsk> = [];
    beginCreation({ ask: ACME, hq: HQ, now: 0, run: (held) => runs.push(held) });
    beginCreation({ ask: IDA, hq: HQ, now: 0, run: (held) => runs.push(held) });
    tryCreationAgain(stoppedAs(ACME, false));
    tryCreationAgain(stoppedAs(IDA, false));
    expect(runs.map((held) => [held.ask.birthId, held.presses])).toEqual([
      ["b-acme", 1],
      ["add-1", 1],
      ["b-acme", 1],
      ["add-1", 2],
    ]);
  });

  it("never tries again one the platform may have taken: it could be made twice", () => {
    const run = vi.fn();
    beginCreation({ ask: IDA, hq: HQ, now: 0, run });
    tryCreationAgain(stoppedAs(IDA, true));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("Dismiss takes it out of the menu, another beside it staying, and asks for nothing", () => {
    beginCreation({ ask: IDA, hq: HQ, now: 0, run: () => undefined });
    beginCreation({
      ask: { ...IDA, birthId: "add-2", botName: "Otto" },
      hq: HQ,
      now: 0,
      run: () => undefined,
    });
    mount();
    act(() => dismissCreation("add-1"));
    expect(drawn.map((creation) => creation.birthId)).toEqual(["add-2"]);
    expect(useNewMateDialog.getState().asked).toBeNull();
  });

  it("Start over takes an Add refused for certain out, and opens Add over its project, its name there to change", () => {
    beginCreation({ ask: IDA, hq: HQ, now: 0, run: () => undefined });
    mount();
    act(() => startAddOver(stoppedAs(IDA, false)));
    expect(drawn).toEqual([]);
    expect(useNewMateDialog.getState().asked).toMatchObject({
      groupId: "app-acme",
      again: { botName: "Ida", tint: "rose", shape: "seal" },
    });
  });

  it("never starts over one Zerops may have made", () => {
    beginCreation({ ask: IDA, hq: HQ, now: 0, run: () => undefined });
    mount();
    act(() => startAddOver(stoppedAs(IDA, true)));
    expect(drawn).toHaveLength(1);
    expect(useNewMateDialog.getState().asked).toBeNull();
  });

  it("runs a creation once at a time: a second press while one is at it does nothing", async () => {
    let finish: () => void = () => undefined;
    const run = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const first = runOnce("b-acme", run);
    await runOnce("b-acme", run);
    expect(run).toHaveBeenCalledTimes(1);
    finish();
    await first;
    // Over, it runs again on the next press.
    const again = vi.fn(async () => undefined);
    await runOnce("b-acme", again);
    expect(again).toHaveBeenCalledTimes(1);
  });

  // Reload is an account close/open: what the tab was asked lived in its memory alone.
  it("keeps nothing of a creation once its account closes, and runs nothing again", () => {
    const run = vi.fn();
    beginCreation({ ask: ACME, hq: HQ, now: 0, run });
    closeAccountLifetime();
    openAccountLifetime("u-ada");
    mount();
    expect(drawn).toEqual([]);
    tryCreationAgain(stoppedAs(ACME, false));
    expect(run).toHaveBeenCalledTimes(1);
  });
});
