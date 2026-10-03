import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { ProjectCloneToastCoordinator } from "./ProjectCloneToastCoordinator";

const reads = vi.hoisted(() => ({ followed: [] as unknown[] }));

vi.mock("../state/environments", () => ({
  useEnvironments: () => ({
    environments: [
      { environmentId: "open-mate", connection: { phase: "connected" } },
      { environmentId: "parked-mate", connection: { phase: "available" } },
    ],
  }),
}));
vi.mock("../state/projectClones", () => ({
  useEnvironmentProjectClones: (environmentId: unknown) => {
    reads.followed.push(environmentId);
    return [];
  },
}));
vi.mock("@tanstack/react-router", () => ({ useParams: () => ({}) }));
vi.mock("../hooks/useHandleNewThread", () => ({ useNewThreadHandler: () => async () => {} }));
vi.mock("../hooks/useRemoveClonedProject", () => ({
  useRemoveClonedProject: () => async () => {},
}));
vi.mock("../state/use-atom-command", () => ({ useAtomCommand: () => async () => ({}) }));

const mounted: ReactTestRenderer[] = [];

afterEach(() => {
  for (const renderer of mounted.splice(0)) act(() => renderer.unmount());
  reads.followed = [];
});

describe("ProjectCloneToastCoordinator", () => {
  it("follows clones only on the Mates this browser is connected to", () => {
    act(() => {
      mounted.push(create(<ProjectCloneToastCoordinator />));
    });

    expect([...new Set(reads.followed)]).toEqual(["open-mate"]);
  });
});
