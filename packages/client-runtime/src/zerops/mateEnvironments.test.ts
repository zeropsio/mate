import { describe, expect, it } from "vite-plus/test";

import type { ZeropsCandidate } from "./candidates.ts";
import {
  hasMate,
  hasMateContainer,
  mateEnvironmentsEmptyReason,
  selectMateEnvironments,
} from "./mateEnvironments.ts";

function project(id: string, tagList: ReadonlyArray<string> = []) {
  return { id, name: id, status: "ACTIVE", tagList };
}

function withMate(
  id: string,
  group: ZeropsCandidate["group"] = "ready",
  serviceId = "zcp",
): ZeropsCandidate {
  return {
    key: `${id}:${serviceId}`,
    project: project(id),
    group,
    service: { id: serviceId, name: "zcp", status: "ACTIVE" },
  };
}

function withoutMate(id: string, tagList: ReadonlyArray<string> = []): ZeropsCandidate {
  return {
    key: id,
    project: project(id, tagList),
    group: "unavailable",
    reason: "no Zerops Mate container in this project",
    missingContainer: true,
  };
}

function tagged(candidate: ZeropsCandidate, tagList: ReadonlyArray<string>): ZeropsCandidate {
  return { ...candidate, project: { ...candidate.project, tagList } };
}

describe("hasMateContainer", () => {
  it.each([
    ["a container backs it", withMate("a"), true],
    ["no container at all", withoutMate("b"), false],
  ] as const)("%s", (_label, candidate, expected) => {
    expect(hasMateContainer(candidate)).toBe(expected);
  });

  it("counts a container that is not currently reachable", () => {
    // Presence is the rule, not liveness: a stopped container is still a place
    // the user works, and the menu must not drop it when the platform hiccups.
    const stopped: ZeropsCandidate = {
      ...withMate("c"),
      group: "unavailable",
      reason: "container is STOPPED",
    };
    expect(hasMateContainer(stopped)).toBe(true);
  });
});

describe("hasMate", () => {
  it.each([
    [
      "the project declares it, container or not",
      withoutMate("a", ["mate", "mate:role:dev"]),
      true,
    ],
    ["a container is there, declared or not", withMate("b"), true],
    ["a dev environment with neither", withoutMate("c", ["mate:g:x", "mate:role:dev"]), false],
    ["a bare project with neither", withoutMate("d"), false],
    [
      "a stage environment, even with a container",
      tagged(withMate("e"), ["mate:role:stage"]),
      false,
    ],
    ["production, even declared", tagged(withMate("f"), ["mate", "mate:role:prod"]), false],
    [
      "a dev/stage environment with a container",
      tagged(withMate("g"), ["mate:role:devstage"]),
      true,
    ],
  ] as const)("%s", (_label, candidate, expected) => {
    expect(hasMate(candidate)).toBe(expected);
  });
});

describe("selectMateEnvironments", () => {
  it("keeps only the projects that have Mate", () => {
    const rows = selectMateEnvironments([withMate("a"), withoutMate("b"), withMate("c")]);
    expect(rows.map((row) => row.project.id)).toEqual(["a", "c"]);
  });

  it("keeps a declared Mate whose container is gone — the card is where it comes back", () => {
    const rows = selectMateEnvironments([withoutMate("a", ["mate"]), withMate("b")]);
    expect(rows.map((row) => row.project.id)).toEqual(["a", "b"]);
  });

  it("never lists production as a Mate, whatever runs in it", () => {
    expect(selectMateEnvironments([tagged(withMate("p"), ["mate:role:prod"])])).toEqual([]);
  });

  it("shows one row per project, however many containers it runs", () => {
    const rows = selectMateEnvironments([
      withMate("a", "ready", "zcp-1"),
      withMate("a", "ready", "zcp-2"),
    ]);
    expect(rows).toHaveLength(1);
  });

  it.each([
    ["connected over ready", "ready", "connected", "connected"],
    ["ready over provisioning", "provisioning", "ready", "ready"],
    ["provisioning over unavailable", "unavailable", "provisioning", "provisioning"],
  ] as const)("prefers the container a click can reach: %s", (_label, worse, better, expected) => {
    const rows = selectMateEnvironments([
      withMate("a", worse, "zcp-1"),
      withMate("a", better, "zcp-2"),
    ]);
    expect(rows[0]?.group).toBe(expected);
  });

  it("does not depend on the order the platform listed them in", () => {
    const forward = selectMateEnvironments([
      withMate("a", "ready", "zcp-1"),
      withMate("a", "ready", "zcp-2"),
    ]);
    const reversed = selectMateEnvironments([
      withMate("a", "ready", "zcp-2"),
      withMate("a", "ready", "zcp-1"),
    ]);
    expect(forward[0]?.key).toBe(reversed[0]?.key);
  });

  it("is empty for an account with no Mate anywhere", () => {
    expect(selectMateEnvironments([withoutMate("a"), withoutMate("b")])).toEqual([]);
  });
});

describe("mateEnvironmentsEmptyReason", () => {
  it.each([
    ["an account with nothing at all", [], "no-projects"],
    ["projects, but Mate on none of them", [withoutMate("a")], "no-mate"],
    ["at least one environment with Mate", [withoutMate("a"), withMate("b")], undefined],
  ] as const)("%s", (_label, candidates, expected) => {
    expect(mateEnvironmentsEmptyReason(candidates)).toBe(expected);
  });
});
