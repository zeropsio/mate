import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { ActivityProcess } from "@t3tools/client-runtime/zerops/activity/dto";
import type { ProjectActivitySnapshot } from "~/zerops/activity/useProjectActivity";
import { ZeropsDeployLog } from "./ZeropsDeployLog";

const mock = vi.hoisted(() => ({
  activity: {
    processes: undefined,
    live: false,
    processHistory: "unread",
  } as ProjectActivitySnapshot,
  demands: [] as (string | null)[],
  releases: [] as (string | null)[],
  logs: vi.fn(),
}));
vi.mock("~/zerops/activity/useProjectActivity", async () => {
  const { useEffect } = await import("react");
  return {
    useProjectActivityRead: () => mock.activity,
    useProjectActivity: (projectId: string | null) => {
      useEffect(() => {
        mock.demands.push(projectId);
        return () => {
          mock.releases.push(projectId);
        };
      }, [projectId]);
      return mock.activity;
    },
  };
});
vi.mock("~/zerops/activity/useBuildLog", () => ({
  useBuildLog: (input: unknown) => {
    mock.logs(input);
    return {
      lines: [
        { id: "line-1", at: "2026-10-04T10:00:02Z", text: "Build command failed", severity: 3 },
      ],
      status: "ended" as const,
    };
  },
}));
vi.mock("../ui/dialog", () => {
  const Part = ({ children }: { children: React.ReactNode }) => children;
  return {
    Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
      open ? children : null,
    DialogPopup: Part,
    DialogHeader: Part,
    DialogTitle: Part,
    DialogDescription: Part,
    DialogPanel: Part,
  };
});

const TARGET = { jobId: "7", processId: "p7", appVersionId: "v7" };
const PROCESS: ActivityProcess = {
  id: "p7",
  projectId: "project-1",
  serviceStackIds: ["svc-1"],
  actionName: "appVersion.build",
  status: "FAILED",
  created: "2026-10-04T10:00:00Z",
  appVersion: {
    id: "v7",
    status: "BUILD_FAILED",
    build: {
      serviceStackId: "builder-7",
      pipelineStart: "2026-10-04T10:00:00Z",
      startDate: "2026-10-04T10:00:01Z",
      pipelineFailed: "2026-10-04T10:00:02Z",
    },
  },
};
let tree: ReactTestRenderer;
afterEach(() => {
  act(() => tree?.unmount());
  mock.demands.length = 0;
  mock.releases.length = 0;
  mock.logs.mockClear();
});
function mount() {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  act(() => {
    tree = create(<ZeropsDeployLog projectId="project-1" service="api" target={TARGET} />);
  });
}
const toggle = () => act(() => tree.root.findByProps({ "aria-expanded": false }).props.onClick());

describe("deploy inspection", () => {
  it("reads only after View deploy, opens the whole log, and releases the demand when closed", () => {
    mock.activity = { processes: [PROCESS], live: false, processHistory: "read" };
    mount();
    expect(mock.demands).toEqual([]);
    toggle();
    expect(mock.demands).toEqual(["project-1"]);
    expect(
      tree.root.findAllByProps({ "data-zerops-pipeline-step": "RUN_BUILD_COMMANDS" }),
    ).toHaveLength(1);
    expect(mock.logs).toHaveBeenLastCalledWith({
      projectId: "project-1",
      query: {
        buildServiceStackId: "builder-7",
        appVersionId: "v7",
        fromIso: "2026-10-04T09:59:55.000Z",
      },
      live: false,
    });
    act(() => tree.root.findByProps({ "data-zerops-build-log-toggle": true }).props.onClick());
    expect(
      tree.root
        .findByProps({ "aria-label": "Build log" })
        .findAllByType("li")[0]
        ?.children.join(""),
    ).toBe("Build command failed");
    act(() => tree.root.findByProps({ "aria-expanded": true }).props.onClick());
    expect(mock.releases).toEqual(["project-1"]);
  });

  it("says when a retained process has no pipeline steps", () => {
    mock.activity = {
      processes: [{ ...PROCESS, appVersion: { id: "v7" } }],

      live: false,
      processHistory: "read",
    };
    mount();
    toggle();
    expect(JSON.stringify(tree.toJSON())).toContain(
      "Zerops keeps no pipeline steps for this deploy.",
    );
  });

  it.each([
    { processHistory: "read" as const, words: "recent process history" },
    { processHistory: "failed" as const, words: "Close and open it to try again" },
  ])(
    "ends a $processHistory lookup visibly without reading another log",
    ({ processHistory, words }) => {
      mock.activity = { processes: [], live: false, processHistory };
      mount();
      toggle();
      expect(JSON.stringify(tree.toJSON())).toContain(words);
      expect(mock.logs).toHaveBeenLastCalledWith({
        projectId: "project-1",
        query: null,
        live: false,
      });
    },
  );
});

it("discloses known missing deploy history before opening without starting another read", () => {
  mock.activity = { processes: [], live: false, processHistory: "read" };
  mount();
  expect(JSON.stringify(tree.toJSON())).toContain("Deploy history unavailable");
  expect(JSON.stringify(tree.toJSON())).not.toContain("View deploy");
  expect(mock.demands).toEqual([]);
});
