import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { describe, expect, it } from "vite-plus/test";

import type { ZeropsAgentActivity } from "./agentActivity";
import { waitingMatesOf } from "./useSidebarWaiting";

const mate = (id: string, bot: string, group: ZeropsCandidate["group"] = "connected", face = "") =>
  ({
    key: `${id}:zcp`,
    project: {
      id,
      // Named as the Mate is (D3).
      name: bot,
      status: "ACTIVE",
      tagList: ["mate"],
      hq: {
        appId: "aaa",
        appName: "Acme",
        kind: "mate",
        mate: { face },
      },
    },
    group,
    service: { id: "zcp", name: "zcp", status: "ACTIVE" },
  }) as ZeropsCandidate;

const face = (value: ZeropsAgentActivity["face"]) => ({ face: value }) as ZeropsAgentActivity;

describe("waitingMatesOf — the faces the header stacks", () => {
  const KAI = mate("kai", "Kai");
  const NOVA = mate("nova", "Nova");
  const JUNO = mate("juno", "Juno");
  const ASLEEP = mate("zed", "Zed", "ready");
  const faces = new Map([
    ["kai", face("needs")],
    ["nova", face("working")],
    ["juno", face("needs")],
    // Its last word, at rest: no socket to it, and HQ holds no live link of it.
    ["zed", { ...face("needs"), remembered: true } as ZeropsAgentActivity],
  ]);
  const derive = (
    shown: (candidate: ZeropsCandidate) => boolean = () => true,
    order = ["juno", "nova", "kai"],
    reviews: ReadonlyArray<string> = [],
  ) =>
    waitingMatesOf({
      candidates: [KAI, NOVA, JUNO, ASLEEP],
      activityOf: (candidate) => faces.get(candidate.project.id),
      reviewWaits: (candidate) => reviews.includes(candidate.project.id),
      waitsOnViewer: () => true,
      tints: new Map([["kai", "amber"]]),
      order,
      shown,
    });

  // A Mate whose change waits for your review waits on you, as its row and the composer say
  // (`mateFaceOf`); one at work shows its work.
  it.each([
    { case: "asleep, its change waits: stacked", reviews: ["zed"], names: ["Juno", "Kai", "Zed"] },
    { case: "at work, its change waits: not stacked", reviews: ["nova"], names: ["Juno", "Kai"] },
  ])("$case", ({ reviews, names }) => {
    const stacked = derive(undefined, undefined, reviews);
    expect(stacked.map((waiting) => waiting.name)).toEqual(names);
    expect(stacked.every((waiting) => waiting.face === "needs")).toBe(true);
  });

  it("stacks only the Mates whose face says they need somebody, in the menu's order", () => {
    expect(derive().map((waiting) => waiting.name)).toEqual(["Juno", "Kai"]);
  });

  it("leaves out a Mate the menu does not show (Mine), and one with no live word of it", () => {
    expect(
      derive((candidate) => candidate.project.id !== "juno").map((waiting) => waiting.name),
    ).toEqual(["Kai"]);
  });

  it("an unopened Mate waiting on its signer is in the stack", () => {
    // No socket to it: HQ's live word of it says it asks.
    const lone = mate("lone", "Lone", "ready");
    const stacked = waitingMatesOf({
      candidates: [lone],
      activityOf: () => face("needs"),
      reviewWaits: () => false,
      waitsOnViewer: () => true,
      tints: new Map(),
      order: [],
      shown: () => true,
    });
    expect(stacked.map((waiting) => waiting.name)).toEqual(["Lone"]);
  });

  it("wears each Mate's own colour, and its face", () => {
    expect(derive().find((waiting) => waiting.projectId === "kai")).toEqual({
      projectId: "kai",
      name: "Kai",
      tint: "amber",
      shape: "hexagon",
      face: "needs",
    });
  });

  it("wears the shape a Mate's person picked", () => {
    const juno = mate("juno", "Juno", "connected", "rose:seal");
    const [waiting] = waitingMatesOf({
      candidates: [juno],
      activityOf: () => face("needs"),
      reviewWaits: () => false,
      waitsOnViewer: () => true,
      tints: new Map([["juno", "rose"]]),
      order: [],
      shown: () => true,
    });
    expect(waiting).toMatchObject({ tint: "rose", shape: "seal" });
  });

  // "sana doesn't wait for me, it waits for karlos" (the owner, 2026-09-30): only the Mates HQ
  // says wait on the viewer — the ones they signed in — wait on them.
  it.each([
    { case: "own Mate asking", waits: true, asks: true, review: false, stacked: true },
    { case: "own Mate, its change waiting", waits: true, asks: false, review: true, stacked: true },
    { case: "another's Mate asking", waits: false, asks: true, review: false, stacked: false },
    {
      case: "another's Mate, its change waiting",
      waits: false,
      asks: false,
      review: true,
      stacked: false,
    },
  ])("$case", ({ waits, asks, review, stacked }) => {
    const sana = mate("sana", "Sana", "connected");
    const waiting = waitingMatesOf({
      candidates: [sana],
      activityOf: () => face(asks ? "needs" : "idle"),
      reviewWaits: () => review,
      waitsOnViewer: (projectId) => projectId === "sana" && waits,
      tints: new Map(),
      order: [],
      shown: () => true,
    });
    expect(waiting.length > 0).toBe(stacked);
  });

  it("puts a Mate the menu has not drawn yet after the ones it has", () => {
    expect(derive(() => true, ["kai"]).map((waiting) => waiting.name)).toEqual(["Kai", "Juno"]);
  });
});
