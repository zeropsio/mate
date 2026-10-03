import { describe, expect, it, vi } from "vite-plus/test";

import { addedMateBirth } from "./useEnvironmentCreation";

describe("addedMateBirth — the birth intent an added Mate is pressed under", () => {
  const hq = () => ({ recordBirth: vi.fn(async () => ({ id: "b-gus", name: "Gus", face: "" })) });

  // F6c (2026-10-03): recorded at HQ before its project exists, so a press cut off between the
  // project and its attach is finished where and as it was asked for, in any browser. Audit B3:
  // with the person's stand-up ask — a dev Mate's — which its attach records with the Mate.
  it.each([
    { case: "a dev Mate, asking its stand-up", role: "dev" as const, standUp: true },
    { case: "a devstage Mate, asking none", role: "devstage" as const, standUp: false },
  ])("records $case, in its application under its name and face", async ({ role, standUp }) => {
    const api = hq();
    expect(
      await addedMateBirth(api, {
        groupId: "app-g",
        role,
        choice: {
          name: "G - Gus",
          withAgent: true,
          botName: "Gus",
          face: { tint: "rose", shape: "seal" },
        },
      }),
    ).toBe("b-gus");
    expect(api.recordBirth).toHaveBeenCalledWith({
      appId: "app-g",
      name: "Gus",
      face: "rose:seal",
      standUp,
    });
  });

  it.each([
    { case: "a stage, its agent and all", role: "stage" as const, withAgent: true },
    { case: "a production", role: "prod" as const, withAgent: false },
    { case: "a dev environment with no agent", role: "dev" as const, withAgent: false },
  ])("records none for $case: no Mate is born", async ({ role, withAgent }) => {
    const api = hq();
    expect(
      await addedMateBirth(api, {
        groupId: "app-g",
        role,
        choice: { name: "G - stage", withAgent },
      }),
    ).toBeUndefined();
    expect(api.recordBirth).not.toHaveBeenCalled();
  });
});
