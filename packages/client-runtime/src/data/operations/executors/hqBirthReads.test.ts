import { describe, expect, it } from "vite-plus/test";

import { HQ_BIRTH_START } from "../../../zerops/hq/birth.ts";
import { birthSnapshot } from "../../../zerops/hq/birthJournal.ts";
import { hqBirthReads } from "./hqBirthReads.ts";

const record = (step: "services" | "done") =>
  new Map([["MATE_HQ_BIRTH_RECORD_0", birthSnapshot({ ...HQ_BIRTH_START, step })]]);

describe("hqBirthReads", () => {
  it("finds births under way by their journal, and a project like HQ's that holds none", async () => {
    const reads = hqBirthReads({
      listClientProjects: async () =>
        [
          { id: "p-under", status: "ACTIVE" },
          { id: "p-done", status: "ACTIVE" },
          { id: "p-gone", status: "DELETING" },
          { id: "p-plain", status: "ACTIVE" },
        ] as never,
      readProjectBirthEnv: async (projectId) =>
        projectId === "p-under"
          ? record("services")
          : projectId === "p-done"
            ? record("done")
            : new Map(),
      listProjectServices: async () => [{ name: "db" }, { name: "vol" }] as never,
      listOrganizationMembers: async () => [],
    });
    expect(await reads.births("org")).toEqual({
      underway: [{ projectId: "p-under", record: { ...HQ_BIRTH_START, step: "services" } }],
      unrecorded: false,
    });
  });

  it("names the HQ the member list marks", async () => {
    const mark = (name: string) => ({
      roleCode: "ADMIN",
      status: "ACTIVE",
      user: { fullName: name, email: "token-1@zerops.io" },
    });
    const reads = (members: ReadonlyArray<ReturnType<typeof mark>>) =>
      hqBirthReads({
        listClientProjects: async () => [],
        readProjectBirthEnv: async () => new Map(),
        listProjectServices: async () => [],
        listOrganizationMembers: async () => members as never,
      });
    expect(await reads([]).markedHq("org")).toEqual({ kind: "none" });
    expect(
      await reads([mark("mate-hq:a:https://a"), mark("mate-hq:b:https://b")]).markedHq("org"),
    ).toEqual({ kind: "unclear", projectIds: ["a", "b"] });
  });
});
