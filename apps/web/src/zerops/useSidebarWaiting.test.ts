import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { describe, expect, it } from "vite-plus/test";

import type { ZeropsAgentActivity } from "./agentActivity";
import { waitingMatesOf } from "./useSidebarWaiting";

/** Who is looking, and who signed each Mate in unless a test says otherwise: the viewer. */
const VIEWER = "u-petra";

const mate = (
  id: string,
  bot: string,
  group: ZeropsCandidate["group"] = "connected",
  signer: string | null = VIEWER,
  face = "",
) =>
  ({
    key: `${id}:zcp`,
    project: {
      id,
      name: id,
      status: "ACTIVE",
      tagList: ["mate", ...(signer === null ? [] : [`mate:signer:claude-code:${signer}`])],
      hq: { appId: "aaa", appName: "Acme", kind: "mate", mate: { name: bot, face } },
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
    ["zed", face("needs")],
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
      viewer: VIEWER,
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

  it("leaves out a Mate the menu does not show (Mine), and one nobody is connected to", () => {
    expect(
      derive((candidate) => candidate.project.id !== "juno").map((waiting) => waiting.name),
    ).toEqual(["Kai"]);
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
    const juno = mate("juno", "Juno", "connected", VIEWER, "rose:seal");
    const [waiting] = waitingMatesOf({
      candidates: [juno],
      activityOf: () => face("needs"),
      reviewWaits: () => false,
      viewer: VIEWER,
      tints: new Map([["juno", "rose"]]),
      order: [],
      shown: () => true,
    });
    expect(waiting).toMatchObject({ tint: "rose", shape: "seal" });
  });

  // "sana doesn't wait for me, it waits for karlos" (the owner, 2026-09-30): only the viewer's
  // own Mates wait on them — the ones they signed in.
  it.each([
    { case: "own Mate asking", signer: VIEWER, asks: true, review: false, stacked: true },
    {
      case: "own Mate, its change waiting",
      signer: VIEWER,
      asks: false,
      review: true,
      stacked: true,
    },
    {
      case: "another's Mate asking",
      signer: "u-karlos",
      asks: true,
      review: false,
      stacked: false,
    },
    {
      case: "another's Mate, its change waiting",
      signer: "u-karlos",
      asks: false,
      review: true,
      stacked: false,
    },
    { case: "nobody signed in, asking", signer: null, asks: true, review: true, stacked: false },
  ])("$case", ({ signer, asks, review, stacked }) => {
    const sana = mate("sana", "Sana", "connected", signer);
    const waiting = waitingMatesOf({
      candidates: [sana],
      activityOf: () => face(asks ? "needs" : "idle"),
      reviewWaits: () => review,
      viewer: VIEWER,
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
