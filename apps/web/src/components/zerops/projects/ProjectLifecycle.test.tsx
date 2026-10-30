import { createElement, type ComponentProps } from "react";
import { deployedVersion } from "@t3tools/client-runtime/zerops";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vite-plus/test";

vi.mock("~/zerops/useNowMs", () => ({ useNowMs: () => 0 }));
vi.mock("~/zerops/useHqAppDetail", () => ({
  useHqAppDetail: vi.fn(() => ({ changes: [], failure: null })),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    params = {},
    search,
    ...props
  }: ComponentProps<"a"> & {
    to: string;
    params?: Record<string, string>;
    search?: Record<string, string>;
  }) =>
    createElement("a", {
      ...props,
      href:
        to.replace(/\$(\w+)/gu, (_, key: string) => params[key] ?? "") +
        (search === undefined ? "" : `?${new URLSearchParams(search)}`),
    }),
}));

import { useHqAppDetail } from "~/zerops/useHqAppDetail";
import { ProjectLifecycle } from "./ProjectLifecycle";
import { entry, FLOW_PROPS, pull, RELEASING, WREN, type Item } from "./flowTestFixtures";
import type { ProjectsFlowGroup } from "./ZeropsProjectsFlow";

function draw(group: ProjectsFlowGroup<Item>) {
  return renderToStaticMarkup(
    <ProjectLifecycle
      entry={group}
      props={{ ...FLOW_PROPS, renderReleaseVerb: () => <button>Review release</button> }}
      mates={<p>Wren's workspace and preview</p>}
      renderPlace={(line) => (
        <p>
          {line.kind}: {line.words.join(" · ")}
        </p>
      )}
      renderSetUp={(_line, action) => <button disabled={action === "busy"}>Set up</button>}
    />,
  );
}

it("Lifecycle holds the project's detail while it replaces the overview", () => {
  draw(RELEASING);
  expect(useHqAppDetail).toHaveBeenCalledWith(RELEASING.group.groupId);
});

it("Lifecycle keeps release review available when optional Stage's build failed", () => {
  const html = draw({
    ...RELEASING,
    flow: {
      ...RELEASING.flow,
      production: {
        kind: "ready-to-release",
        stop: {
          projectId: "production",
          name: "Production",
          state: "deployed",
          version: undefined,
          source: "release",
          addresses: [],
        },
        line: "Waiting for release",
        candidate: { tag: "v1.0.1", waiting: 1 },
      },
      stages: [
        {
          projectId: "stage",
          name: "Stage",
          state: "failed",
          version: undefined,
          source: "main",
          addresses: [],
        },
      ],
    },
  });
  expect(html).toContain("Review release");
  expect(html).toContain("stage:");
  expect(html).toContain("Stage is optional");
});

it.each([
  {
    title: "Lifecycle offers an optional Stage only when none is declared or being created",
    unread: [],
    creating: [],
    optional: true,
  },
  {
    title: "Lifecycle does not mistake an unread Stage for an absent environment",
    unread: ["Shared testing"],
    creating: [],
    optional: false,
  },
  {
    title: "Lifecycle shows a Stage being created instead of offering another empty Stage",
    unread: [],
    creating: [{ projectId: "stage", name: "Stage", kind: "stage" as const }],
    optional: false,
  },
])("$title", ({ unread, creating, optional }) => {
  const base = entry([WREN]);
  const html = draw({
    ...base,
    flow: { ...base.flow, unreadStages: unread, creatingStages: creating },
  });
  expect(html.includes(">Optional</span>")).toBe(optional);
});

it("Lifecycle does not expose the last merged change when its access is unverified", () => {
  const base = entry([WREN], { mainHasCode: true });
  const html = draw({
    ...base,
    changesUnknown: "unseen",
    lastMerged: pull({ title: "Protected change title", merged: true }),
  });
  expect(html).toContain("Merged code cannot be verified");
  expect(html).not.toContain("Protected change title");
});

it("Lifecycle names data and vault recovery separately from a code rollback", () => {
  expect(draw(RELEASING)).toContain("They do not copy or restore runtime data or vault values");
});

it("Lifecycle does not claim there are no changes while the project's detail is being read", () => {
  vi.mocked(useHqAppDetail).mockReturnValueOnce({ changes: undefined, failure: null } as ReturnType<
    typeof useHqAppDetail
  >);
  expect(draw(RELEASING)).toContain("Reading changes…");
});

it("Lifecycle names Stage's observed code rather than the current main head", () => {
  const html = draw({
    ...RELEASING,
    flow: {
      ...RELEASING.flow,
      main: { ...RELEASING.flow.main, head: "1234567" },
      stages: [
        {
          projectId: "stage",
          name: "Stage",
          state: "deployed",
          version: deployedVersion("main abcdef1"),
          source: "main",
          addresses: [],
        },
      ],
    },
  });
  expect(html).toContain("Last observed version: main · abcdef1");
  expect(html).not.toContain("1234567");
});

it("Lifecycle keeps a project's unfinished setup visible beside its deployment map", () => {
  const base = entry([WREN]);
  expect(draw({ ...base, line: "Setting up production isn't finished" })).toContain(
    "Setting up production isn&#x27;t finished",
  );
});
