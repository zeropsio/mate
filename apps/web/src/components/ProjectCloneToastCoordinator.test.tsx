import type { AccountEnvironments } from "@t3tools/client-runtime/zerops/account/runtime";
import type { EnvironmentId, ProjectCloneSnapshot, ProjectId } from "@t3tools/contracts";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { bindAccountEnvironments } from "../zerops/accountEnvironments";
import { ProjectCloneToastCoordinator } from "./ProjectCloneToastCoordinator";

const reads = vi.hoisted(() => ({
  followed: [] as unknown[],
  /** The clones each environment lists. */
  clones: new Map<unknown, ReadonlyArray<unknown>>(),
  /** What happened, in order: a Mate held and let go. */
  log: [] as Array<string>,
  /** The link of the Mate this page has open. */
  openPhase: "connected",
}));

vi.mock("../state/environments", () => ({
  useEnvironments: () => ({
    environments: [
      { environmentId: "open-mate", connection: { phase: reads.openPhase } },
      { environmentId: "parked-mate", connection: { phase: "available" } },
    ],
  }),
}));
vi.mock("../state/projectClones", () => ({
  useEnvironmentProjectClones: (environmentId: unknown) => {
    reads.followed.push(environmentId);
    return reads.clones.get(environmentId) ?? [];
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
  reads.clones.clear();
  reads.log = [];
  reads.openPhase = "connected";
});

/** An account bound whose holds and releases go into `reads.log`; the answer unbinds it. */
const bindHolder = () =>
  bindAccountEnvironments({
    hold: (environmentId: EnvironmentId) => {
      reads.log.push(`hold ${environmentId}`);
      return () => {
        reads.log.push(`release ${environmentId}`);
      };
    },
  } as unknown as AccountEnvironments);

const clone = (phase: ProjectCloneSnapshot["phase"]): ProjectCloneSnapshot => ({
  projectId: "project-1" as ProjectId,
  remoteUrl: "https://github.com/acme/app.git",
  destinationPath: "/var/www/app",
  repository: null,
  phase,
  stage: "receiving",
  percent: 40,
  detail: null,
  error: null,
  startedAt: "2026-10-03T09:00:00.000Z",
  endedAt: null,
  sequence: 1,
});

describe("ProjectCloneToastCoordinator", () => {
  it("follows no clone on a Mate this browser holds parked", () => {
    act(() => {
      mounted.push(create(<ProjectCloneToastCoordinator />));
    });

    expect([...new Set(reads.followed)]).toEqual(["open-mate"]);
  });

  it("holds the Mate a clone runs on, so a park does not take its toast", () => {
    const unbind = bindHolder();
    reads.clones.set("open-mate", [clone("running")]);
    act(() => {
      mounted.push(create(<ProjectCloneToastCoordinator />));
    });

    expect(reads.log).toEqual(["hold open-mate"]);
    unbind();
  });

  it("keeps holding a running clone's Mate while its link comes back", () => {
    const unbind = bindHolder();
    reads.clones.set("open-mate", [clone("running")]);
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<ProjectCloneToastCoordinator />);
    });
    mounted.push(renderer);
    act(() => {
      reads.openPhase = "backoff";
      renderer.update(<ProjectCloneToastCoordinator />);
    });

    expect(reads.log).toEqual(["hold open-mate"]);
    unbind();
  });
});
