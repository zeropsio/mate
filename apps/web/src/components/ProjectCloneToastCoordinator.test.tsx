import type { AccountEnvironments } from "@t3tools/client-runtime/zerops/account/runtime";
import type { EnvironmentId, ProjectCloneSnapshot, ProjectId } from "@t3tools/contracts";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { bindAccountEnvironments } from "../zerops/accountEnvironments";
import { ProjectCloneToastCoordinator } from "./ProjectCloneToastCoordinator";
import { toastManager } from "./ui/toast";

const reads = vi.hoisted(() => ({
  followed: [] as unknown[],
  /** The clones each environment lists. */
  clones: new Map<unknown, ReadonlyArray<unknown>>(),
  /** What happened, in order: a Mate held and let go. */
  log: [] as Array<string>,
  /** The link of the Mate this page has open, or null once it is no longer registered. */
  openPhase: "connected" as string | null,
}));

vi.mock("../state/environments", () => ({
  useEnvironments: () => ({
    environments: [
      ...(reads.openPhase === null
        ? []
        : [{ environmentId: "open-mate", connection: { phase: reads.openPhase } }]),
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
vi.mock("@tanstack/react-router", () => ({
  useParams: () => ({}),
  useRouter: () => ({ state: { matches: [] }, navigate: async () => {} }),
}));
vi.mock("../hooks/useHandleNewThread", () => ({ useNewThreadHandler: () => async () => {} }));
vi.mock("../state/use-atom-command", () => ({ useAtomCommand: () => async () => ({}) }));

const mounted: ReactTestRenderer[] = [];

afterEach(() => {
  for (const renderer of mounted.splice(0)) act(() => renderer.unmount());
  vi.restoreAllMocks();
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
    machines: () => new Map(),
    subscribe: () => () => undefined,
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

  it("leaves a settled clone's toast up when its Mate parks", () => {
    const close = vi.spyOn(toastManager, "close");
    reads.clones.set("open-mate", [clone("done")]);
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<ProjectCloneToastCoordinator />);
    });
    mounted.push(renderer);
    act(() => {
      reads.openPhase = "available";
      renderer.update(<ProjectCloneToastCoordinator />);
    });

    expect(close).not.toHaveBeenCalled();
  });

  it("adds no second toast for a settled clone when its Mate connects again", () => {
    const add = vi.spyOn(toastManager, "add");
    reads.clones.set("open-mate", [clone("done")]);
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<ProjectCloneToastCoordinator />);
    });
    mounted.push(renderer);
    for (const phase of ["available", "connected"]) {
      act(() => {
        reads.openPhase = phase;
        renderer.update(<ProjectCloneToastCoordinator />);
      });
    }

    expect(add).toHaveBeenCalledTimes(1);
  });

  it("closes the toasts of a Mate no longer registered", () => {
    const close = vi.spyOn(toastManager, "close");
    reads.clones.set("open-mate", [clone("failed")]);
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<ProjectCloneToastCoordinator />);
    });
    mounted.push(renderer);
    act(() => {
      reads.openPhase = null;
      renderer.update(<ProjectCloneToastCoordinator />);
    });

    expect(close).toHaveBeenCalledTimes(1);
  });

  it("holds a parked Mate for the Retry its settled clone's toast offers", async () => {
    const unbind = bindHolder();
    const add = vi.spyOn(toastManager, "add");
    reads.clones.set("open-mate", [clone("failed")]);
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<ProjectCloneToastCoordinator />);
    });
    mounted.push(renderer);
    act(() => {
      reads.openPhase = "available";
      renderer.update(<ProjectCloneToastCoordinator />);
    });
    const retry = add.mock.calls[0]?.[0].actionProps?.onClick;
    await act(async () => {
      retry?.(undefined as never);
    });

    expect(reads.log).toEqual(["hold open-mate", "release open-mate"]);
    unbind();
  });

  it("holds a parked Mate for the removal its failed clone's toast offers", async () => {
    const unbind = bindHolder();
    const add = vi.spyOn(toastManager, "add");
    reads.clones.set("open-mate", [clone("failed")]);
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<ProjectCloneToastCoordinator />);
    });
    mounted.push(renderer);
    act(() => {
      reads.openPhase = "available";
      renderer.update(<ProjectCloneToastCoordinator />);
    });
    const remove = add.mock.calls[0]?.[0].data?.secondaryActionProps?.onClick;
    await act(async () => {
      remove?.(undefined as never);
    });

    expect(reads.log).toEqual(["hold open-mate", "release open-mate"]);
    unbind();
  });
});
