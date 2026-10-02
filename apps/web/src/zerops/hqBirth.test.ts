import { HQ_BIRTH_START, type HqBirthRecord } from "@t3tools/client-runtime/zerops/hq";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { closeAccountLifetime, openAccountLifetime } from "./accountLifetime";
import { bearHq, hqBirthView, useHqBirths } from "./hqBirth";

const HQ = { projectId: "hq-1", address: "https://hq-1-8080.prg1.zerops.app" } as const;

describe("*Set up HQ* — an organization's HQ born on its own", () => {
  beforeEach(() => {
    openAccountLifetime("u-ada");
    useHqBirths.setState({ byOrg: {} });
  });
  afterEach(() => {
    closeAccountLifetime();
  });

  const held = () => useHqBirths.getState().byOrg["org-1"];

  it("names the step that stopped it, and Try again resumes from what it made", async () => {
    const records: Array<HqBirthRecord> = [];
    const onBorn = vi.fn();
    let fail = true;
    const run = vi.fn(
      async (record: HqBirthRecord, moved: (patch: Partial<HqBirthRecord>) => void) => {
        records.push(record);
        await Promise.resolve();
        if (fail) {
          moved({ step: "deploy", projectId: "hq-1" });
          return {
            ok: false as const,
            step: "deploy" as const,
            reason: "offline.",
            uncertain: false,
          };
        }
        moved({ step: "done" });
        return { ok: true as const, hq: HQ };
      },
    );

    bearHq({ clientId: "org-1", run, onBorn });
    expect(hqBirthView(held())).toEqual({ kind: "running", doing: "Creating HQ's project" });
    await vi.waitFor(() => expect(held()?.failed).not.toBeNull());
    expect(hqBirthView(held())).toEqual({
      kind: "failed",
      reason: "Deploying HQ: offline.",
      tryAgain: true,
    });

    fail = false;
    bearHq({ clientId: "org-1", run, onBorn });
    await vi.waitFor(() => expect(onBorn).toHaveBeenCalledTimes(1));
    expect(records).toEqual([
      HQ_BIRTH_START,
      { ...HQ_BIRTH_START, step: "deploy", projectId: "hq-1" },
    ]);
    expect(held()).toBeUndefined();
  });

  it("is pressed once while it runs, and never again where its project may be made twice", async () => {
    let finish: (value: {
      ok: false;
      step: "project";
      reason: string;
      uncertain: true;
    }) => void = () => undefined;
    const run = vi.fn(
      () =>
        new Promise<{ ok: false; step: "project"; reason: string; uncertain: true }>((resolve) => {
          finish = resolve;
        }),
    );
    bearHq({ clientId: "org-1", run, onBorn: () => undefined });
    bearHq({ clientId: "org-1", run, onBorn: () => undefined });
    expect(run).toHaveBeenCalledTimes(1);

    finish({ ok: false, step: "project", reason: "Unsure.", uncertain: true });
    await vi.waitFor(() => expect(held()?.failed?.uncertain).toBe(true));
    expect(hqBirthView(held())).toMatchObject({ kind: "failed", tryAgain: false });
    bearHq({ clientId: "org-1", run, onBorn: () => undefined });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("forgets every birth once its account is signed out", async () => {
    bearHq({ clientId: "org-1", run: () => new Promise(() => undefined), onBorn: () => undefined });
    closeAccountLifetime();
    expect(useHqBirths.getState().byOrg).toEqual({});
  });
});
