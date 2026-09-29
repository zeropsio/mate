import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { describe, expect, it } from "vite-plus/test";

import type { ZeropsAgentActivity } from "./agentActivity";
import { waitingMatesOf } from "./useSidebarWaiting";

const mate = (id: string, bot: string, group: ZeropsCandidate["group"] = "connected") =>
  ({
    key: `${id}:zcp`,
    project: {
      id,
      name: id,
      status: "ACTIVE",
      tagList: ["mate", "mate:g:aaa", "mate:role:dev", `mate:bot:${bot}`],
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
  ) =>
    waitingMatesOf({
      candidates: [KAI, NOVA, JUNO, ASLEEP],
      activityOf: (candidate) => faces.get(candidate.project.id),
      tints: new Map([["kai", "amber"]]),
      order,
      shown,
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
    const picked = mate("juno", "Juno");
    const juno = {
      ...picked,
      project: { ...picked.project, tagList: [...picked.project.tagList!, "mate:face:rose:seal"] },
    };
    const [waiting] = waitingMatesOf({
      candidates: [juno],
      activityOf: () => face("needs"),
      tints: new Map([["juno", "rose"]]),
      order: [],
      shown: () => true,
    });
    expect(waiting).toMatchObject({ tint: "rose", shape: "seal" });
  });

  it("puts a Mate the menu has not drawn yet after the ones it has", () => {
    expect(derive(() => true, ["kai"]).map((waiting) => waiting.name)).toEqual(["Kai", "Juno"]);
  });
});
