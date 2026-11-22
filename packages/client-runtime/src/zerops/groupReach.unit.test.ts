import { expect, it } from "vite-plus/test";

import { newestMateKey, planMateKey, type ZeropsIntegrationToken } from "./groupReach.ts";

// witness: packages/client-runtime/src/zerops/groupReach.ts | MATE_KEY_NAME_PREFIXES.some((prefix) => token.name.startsWith(prefix)) && → true &&
it("ZV113: A Mate's key is a token of its own project alone: a sibling's read grant, a one-project deploy token, another project's Mate key, a group-widened key or a key reaching another project is never taken or reused", () => {
  const others: ReadonlyArray<ZeropsIntegrationToken> = [
    {
      id: "sibling-read",
      name: "zcp-p2",
      projects: [
        { projectId: "p2", roleCode: "BASIC_USER" },
        { projectId: "p1", roleCode: "READ_ONLY" },
      ],
    },
    {
      id: "deploy",
      name: "mate-hq-deploy:stage:p1",
      projects: [{ projectId: "p1", roleCode: "BASIC_USER" }],
    },
    { id: "other-mate", name: "zcp-p2", projects: [{ projectId: "p2", roleCode: "BASIC_USER" }] },
    {
      id: "group-widened",
      name: "zcp-p1",
      projects: [
        { projectId: "p1", roleCode: "ADMIN" },
        { projectId: "p2", roleCode: "READ_ONLY" },
      ],
    },
    {
      id: "reaching-another",
      name: "zcp-p1",
      projects: [
        { projectId: "p1", roleCode: "BASIC_USER" },
        { projectId: "p3", roleCode: "ADMIN" },
      ],
    },
  ];
  const own: ZeropsIntegrationToken = {
    id: "own",
    name: "zcp-p1",
    projects: [{ projectId: "p1", roleCode: "BASIC_USER" }],
  };

  expect(others.map((token) => planMateKey({ token, selfProjectId: "p1" }).kind)).toEqual(
    others.map(() => "not-its-key"),
  );
  expect(newestMateKey(others, "p1")).toBeUndefined();
  expect(planMateKey({ token: own, selfProjectId: "p1" }).kind).toBe("held");
  expect(newestMateKey([...others, own], "p1")?.id).toBe("own");
});
