import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  type ZeropsService,
  type ZeropsTopologySnapshot,
} from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const feedState = vi.hoisted(() => ({
  topologies: new Map<string, ZeropsTopologySnapshot | undefined>(),
}));

vi.mock("../../zerops/useZeropsFeeds", () => ({
  useZeropsTopology: (environmentId: EnvironmentId | null) =>
    environmentId === null ? undefined : feedState.topologies.get(environmentId),
}));

import type { SidebarProjectThreadBranch } from "../../sidebarProjectGrouping";
import { SidebarProjectTree } from "./SidebarProjectTree";

interface FixtureThread {
  readonly id: ThreadId;
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly untouched?: boolean;
}

const environmentId = EnvironmentId.make("environment-one");
const projectId = ProjectId.make("project-one");
const activeThread: FixtureThread = {
  id: ThreadId.make("thread-active"),
  environmentId,
  projectId,
  title: "Active thread",
};
const quietThread: FixtureThread = {
  id: ThreadId.make("thread-quiet"),
  environmentId,
  projectId,
  title: "Quiet thread",
};
const branches: readonly SidebarProjectThreadBranch<FixtureThread>[] = [
  {
    key: "logical-project",
    displayName: "Logical project",
    members: [
      {
        key: "environment-one:project-one",
        environmentId,
        projectId,
        displayName: "Development",
        workspaceLabel: "www",
        threads: [activeThread, quietThread],
      },
    ],
  },
];

const threadKey = (thread: FixtureThread) => `${thread.environmentId}:${thread.id}`;
const renderThread = (thread: FixtureThread) => <li key={thread.id}>{thread.title}</li>;

function maxNestedButtonDepth(markup: string): number {
  let depth = 0;
  let maxDepth = 0;
  for (const token of markup.matchAll(/<\/?button\b/gu)) {
    if (token[0] === "<button") {
      depth += 1;
      maxDepth = Math.max(maxDepth, depth);
    } else {
      depth -= 1;
    }
  }
  return maxDepth;
}

const service = (hostname: string): ZeropsService =>
  ({
    hostname,
    serviceId: `service-${hostname}`,
    type: "ubuntu/nodejs@22",
    status: "ACTIVE",
    group: "runtimes",
    adoptionState: "adopted",
    isManagedService: false,
    transient: false,
    mounted: false,
  }) as ZeropsService;

function topology(projectName: string, serviceCount: number): ZeropsTopologySnapshot {
  return {
    available: true,
    degraded: false,
    project: { id: "zerops-project-one", name: projectName, status: "ACTIVE" },
    services: Array.from({ length: serviceCount }, (_, index) => service(`service-${index + 1}`)),
    warnings: [],
    readAt: new Date("2026-09-01T08:00:00.000Z"),
  } as unknown as ZeropsTopologySnapshot;
}

describe("SidebarProjectTree", () => {
  beforeEach(() => {
    feedState.topologies.clear();
  });

  it("keeps search results flat and active ancestry visible", () => {
    const treeMarkup = renderToStaticMarkup(
      <SidebarProjectTree
        branches={branches}
        searchResults={null}
        activeThreadKey={threadKey(activeThread)}
        collapsedProjectKeys={new Set(["logical-project"])}
        collapsedMemberKeys={new Set(["environment-one:project-one"])}
        getThreadKey={threadKey}
        onToggleProject={vi.fn()}
        onToggleMember={vi.fn()}
        renderThread={renderThread}
      />,
    );

    expect(treeMarkup).toContain("Logical project");
    expect(treeMarkup).toContain("Development");
    expect(treeMarkup).toContain("Active thread");
    expect(treeMarkup).toContain('aria-expanded="true"');

    const searchMarkup = renderToStaticMarkup(
      <SidebarProjectTree
        branches={branches}
        searchResults={[quietThread, activeThread]}
        activeThreadKey={threadKey(activeThread)}
        collapsedProjectKeys={new Set()}
        collapsedMemberKeys={new Set()}
        getThreadKey={threadKey}
        onToggleProject={vi.fn()}
        onToggleMember={vi.fn()}
        renderThread={renderThread}
      />,
    );

    expect(searchMarkup).toContain('aria-label="Thread search results"');
    expect(searchMarkup).toContain("Quiet thread");
    expect(searchMarkup).toContain("Active thread");
    expect(searchMarkup).not.toContain("Logical project");
    expect(searchMarkup).not.toContain("Development");
  });

  it("moves only the first untouched thread into an accessible workspace shortcut", () => {
    const firstUntouched: FixtureThread = {
      ...activeThread,
      id: ThreadId.make("thread-first-untouched"),
      title: "First untouched card",
      untouched: true,
    };
    const secondUntouched: FixtureThread = {
      ...quietThread,
      id: ThreadId.make("thread-second-untouched"),
      title: "Second untouched card",
      untouched: true,
    };
    const shortcutBranches: readonly SidebarProjectThreadBranch<FixtureThread>[] = [
      {
        ...branches[0]!,
        members: [
          {
            ...branches[0]!.members[0]!,
            threads: [firstUntouched, secondUntouched, quietThread],
          },
        ],
      },
    ];

    const markup = renderToStaticMarkup(
      <SidebarProjectTree
        branches={shortcutBranches}
        searchResults={null}
        activeThreadKey={threadKey(firstUntouched)}
        collapsedProjectKeys={new Set()}
        collapsedMemberKeys={new Set(["environment-one:project-one"])}
        getThreadKey={threadKey}
        onToggleProject={vi.fn()}
        onToggleMember={vi.fn()}
        getCompactThreadShortcut={(threads) =>
          threads.find((thread) => thread.untouched === true) ?? null
        }
        renderCompactThreadShortcut={(thread, workspaceName) => (
          <button type="button" aria-label={`Open new thread in ${workspaceName}`}>
            {thread.id}
          </button>
        )}
        renderThread={renderThread}
      />,
    );

    expect(markup).toContain('aria-label="Open new thread in Development"');
    expect(markup).toContain("thread-first-untouched");
    expect(markup).not.toContain("First untouched card");
    expect(markup).toContain("Second untouched card");
    expect(markup).toContain("Quiet thread");
    expect(markup).toContain('aria-label="Collapse workspace Development"');
    expect(markup).toContain('aria-expanded="true"');
    expect(maxNestedButtonDepth(markup)).toBe(1);

    const collapsedMarkup = renderToStaticMarkup(
      <SidebarProjectTree
        branches={shortcutBranches}
        searchResults={null}
        activeThreadKey={null}
        collapsedProjectKeys={new Set()}
        collapsedMemberKeys={new Set(["environment-one:project-one"])}
        getThreadKey={threadKey}
        onToggleProject={vi.fn()}
        onToggleMember={vi.fn()}
        getCompactThreadShortcut={(threads) =>
          threads.find((thread) => thread.untouched === true) ?? null
        }
        renderCompactThreadShortcut={(thread, workspaceName) => (
          <button type="button" aria-label={`Open new thread in ${workspaceName}`}>
            {thread.id}
          </button>
        )}
        renderThread={renderThread}
      />,
    );

    expect(collapsedMarkup).toContain('aria-label="Expand workspace Development"');
    expect(collapsedMarkup).toContain('aria-label="Open new thread in Development"');
    expect(collapsedMarkup).not.toContain("Second untouched card");
    expect(maxNestedButtonDepth(collapsedMarkup)).toBe(1);
  });

  it.each([
    { serviceCount: 1, expectedMeta: "1 service · zcp" },
    { serviceCount: 2, expectedMeta: "2 services · zcp" },
  ])(
    "uses the topology project name and service meta for $serviceCount services",
    ({ serviceCount, expectedMeta }) => {
      feedState.topologies.set(environmentId, topology("Todo dev", serviceCount));
      const genericBranches: readonly SidebarProjectThreadBranch<FixtureThread>[] = [
        {
          ...branches[0]!,
          displayName: "www",
          members: [
            {
              ...branches[0]!.members[0]!,
              displayName: "node-id-1.runtime.zcp.zerops",
              workspaceLabel: "www",
            },
          ],
        },
      ];

      const markup = renderToStaticMarkup(
        <SidebarProjectTree
          branches={genericBranches}
          searchResults={null}
          activeThreadKey={null}
          collapsedProjectKeys={new Set()}
          collapsedMemberKeys={new Set()}
          getThreadKey={threadKey}
          onToggleProject={vi.fn()}
          onToggleMember={vi.fn()}
          renderThread={renderThread}
        />,
      );

      expect(markup).toContain(">Projects</span>");
      expect(markup).toContain("Todo dev");
      expect(markup).toContain(expectedMeta);
      expect(markup).not.toContain("node-id-1.runtime.zcp.zerops");
      expect(markup).not.toContain(">www<");
    },
  );

  it("coalesces generic Zerops branches into one truthful Projects section", () => {
    const secondEnvironmentId = EnvironmentId.make("environment-two");
    const secondProjectId = ProjectId.make("project-two");
    const secondThread: FixtureThread = {
      id: ThreadId.make("thread-second"),
      environmentId: secondEnvironmentId,
      projectId: secondProjectId,
      title: "Second project thread",
    };
    feedState.topologies.set(environmentId, topology("zerops-xyz", 2));
    feedState.topologies.set(secondEnvironmentId, topology("zerops-code", 2));
    const genericBranches: readonly SidebarProjectThreadBranch<FixtureThread>[] = [
      {
        key: "logical-project-one",
        displayName: "www",
        members: [
          {
            ...branches[0]!.members[0]!,
            displayName: "node-id-1.runtime.zcp.zerops",
            workspaceLabel: "www",
            threads: [activeThread],
          },
        ],
      },
      {
        key: "logical-project-two",
        displayName: "www",
        members: [
          {
            key: "environment-two:project-two",
            environmentId: secondEnvironmentId,
            projectId: secondProjectId,
            displayName: "node-id-2.runtime.zcp.zerops",
            workspaceLabel: "www",
            threads: [secondThread],
          },
        ],
      },
    ];

    const markup = renderToStaticMarkup(
      <SidebarProjectTree
        branches={genericBranches}
        searchResults={null}
        activeThreadKey={null}
        collapsedProjectKeys={new Set()}
        collapsedMemberKeys={new Set()}
        getThreadKey={threadKey}
        onToggleProject={vi.fn()}
        onToggleMember={vi.fn()}
        renderThread={renderThread}
      />,
    );

    expect(markup.match(/>Projects<\/span>/gu)).toHaveLength(1);
    expect(markup).toContain("2 workspaces");
    expect(markup).toContain("zerops-xyz");
    expect(markup).toContain("zerops-code");
    expect(markup.match(/2 services · zcp/gu)).toHaveLength(2);
    expect(markup).toContain("Active thread");
    expect(markup).toContain("Second project thread");
    expect(markup).not.toContain("node-id-1.runtime.zcp.zerops");
    expect(markup).not.toContain("node-id-2.runtime.zcp.zerops");
    expect(markup).not.toContain("1 workspace");
  });

  it("keeps non-Zerops fallbacks and non-generic logical project names", () => {
    feedState.topologies.set(environmentId, {
      ...topology("Ignored project", 0),
      available: false,
      project: undefined,
    });
    const genericFallbackBranches: readonly SidebarProjectThreadBranch<FixtureThread>[] = [
      { ...branches[0]!, displayName: "www" },
    ];

    const fallbackMarkup = renderToStaticMarkup(
      <SidebarProjectTree
        branches={genericFallbackBranches}
        searchResults={null}
        activeThreadKey={null}
        collapsedProjectKeys={new Set()}
        collapsedMemberKeys={new Set()}
        getThreadKey={threadKey}
        onToggleProject={vi.fn()}
        onToggleMember={vi.fn()}
        renderThread={renderThread}
      />,
    );

    expect(fallbackMarkup).toContain(">www</span>");
    expect(fallbackMarkup).toContain(">Development</span>");
    expect(fallbackMarkup).toContain("2 threads");
    expect(fallbackMarkup).not.toContain("· zcp");
    expect(fallbackMarkup).not.toContain(">Projects</span>");

    feedState.topologies.set(environmentId, topology("Todo dev", 0));
    const namedProjectMarkup = renderToStaticMarkup(
      <SidebarProjectTree
        branches={branches}
        searchResults={null}
        activeThreadKey={null}
        collapsedProjectKeys={new Set()}
        collapsedMemberKeys={new Set()}
        getThreadKey={threadKey}
        onToggleProject={vi.fn()}
        onToggleMember={vi.fn()}
        renderThread={renderThread}
      />,
    );

    expect(namedProjectMarkup).toContain(">Logical project</span>");
    expect(namedProjectMarkup).not.toContain(">Projects</span>");
  });
});
