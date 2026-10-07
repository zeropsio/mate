import type { HalfMadeGroupEnvironment } from "@t3tools/client-runtime/zerops";
import { act, createElement } from "react";
import { create } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { AddGroupEnvironmentOutcome } from "./addGroupEnvironment";
import {
  useFinishGroupEnvironment,
  type FinishGroupEnvironment,
} from "./useFinishGroupEnvironment";

/** The finishes run, and how the next one goes. */
const finishes = vi.hoisted(() => ({
  run: [] as Array<{ readonly projectId: string }>,
  /** The next one fails a step the page cannot fix by itself. */
  failNext: false,
}));

vi.mock("./addGroupEnvironment", () => ({
  addGroupEnvironment: async (input: { readonly environment: { readonly project: string } }) => {
    finishes.run.push({ projectId: input.environment.project });
    if (finishes.failNext) {
      finishes.failNext = false;
      return {
        done: ["registry"],
        failed: { step: "deploy-token", reason: "HQ is not answering right now." },
      } satisfies AddGroupEnvironmentOutcome;
    }
    return {
      done: ["registry", "deploy-token"],
      failed: undefined,
    } satisfies AddGroupEnvironmentOutcome;
  },
}));

const STAGE: HalfMadeGroupEnvironment = { groupId: "g1", projectId: "p-stage", tier: "stage" };
const HQ = { projectId: "hq-1", address: "https://hq-1-8080.prg1.zerops.app" } as const;
/** The account's operations: `addGroupEnvironment` stands in for their use here. */
const OPERATIONS = { run: vi.fn(), untilEnvironment: vi.fn() };

/** The hook as the projects page holds it, its every answer kept, the latest last. */
async function mounted() {
  const seen: Array<FinishGroupEnvironment> = [];
  function Probe() {
    seen.push(useFinishGroupEnvironment({ operations: OPERATIONS, clientId: "org-1", hq: HQ }));
    return null;
  }
  let root: ReturnType<typeof create> | undefined;
  await act(async () => {
    root = create(createElement(Probe));
  });
  return { latest: () => seen.at(-1)!, unmount: () => act(async () => root!.unmount()) };
}

// Audit R2: opening Projects resumed a half-made stage or production and minted its deploy key,
// with nobody asking (an admin's open client minted one 1 s after an import). Finishing one is
// the person's own verb now, with what it came to said on its project's row.
describe("useFinishGroupEnvironment", () => {
  afterEach(() => {
    finishes.run = [];
    finishes.failNext = false;
  });

  it("a load with a half-made environment mints no deploy key", async () => {
    const page = await mounted();
    await act(async () => {
      await Promise.resolve();
    });
    expect([finishes.run, page.latest().finishing.size]).toEqual([[], 0]);
    await page.unmount();
  });

  it("finishes the environment the person asks, once, and says what it came to", async () => {
    const page = await mounted();
    finishes.failNext = true;
    await act(async () => {
      page.latest().finish(STAGE);
    });
    expect([finishes.run, page.latest().unfinished.get("g1")]).toEqual([
      [{ projectId: "p-stage" }],
      "stage",
    ]);
    // Asked again, it goes through, and the row says nothing more.
    await act(async () => {
      page.latest().finish(STAGE);
    });
    expect([finishes.run.length, page.latest().unfinished.has("g1")]).toEqual([2, false]);
    await page.unmount();
  });
});
