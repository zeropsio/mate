import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import type { SidebarProjectThreadBranch } from "../../sidebarProjectGrouping";
import { SidebarProjectTree } from "./SidebarProjectTree";

interface FixtureThread {
  readonly id: ThreadId;
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly title: string;
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

describe("SidebarProjectTree", () => {
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
});
