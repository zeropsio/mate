import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildSidebarProjectThreadBranches } from "./sidebarProjectGrouping";

const environmentOne = EnvironmentId.make("environment-one");
const environmentTwo = EnvironmentId.make("environment-two");
const environmentThree = EnvironmentId.make("environment-three");
const projectOne = ProjectId.make("project-one");
const projectTwo = ProjectId.make("project-two");
const projectThree = ProjectId.make("project-three");

const projectGroup = {
  projectKey: "github.com/acme/app",
  displayName: "Acme app",
  memberProjects: [
    {
      id: projectOne,
      environmentId: environmentOne,
      environmentLabel: "dev-one",
      workspaceRoot: "/var/www",
      title: "www",
    },
    {
      id: projectTwo,
      environmentId: environmentTwo,
      environmentLabel: "dev-two",
      workspaceRoot: "/srv/app",
      title: "app",
    },
    {
      id: projectThree,
      environmentId: environmentThree,
      environmentLabel: null,
      workspaceRoot: "/opt/worker/",
      title: "Worker service",
    },
  ],
};

describe("buildSidebarProjectThreadBranches", () => {
  it("builds project environment thread branches without cross-environment leakage", () => {
    const threadOne = {
      id: ThreadId.make("thread-one"),
      environmentId: environmentOne,
      projectId: projectOne,
      title: "Thread one",
    };
    const threadTwo = {
      id: ThreadId.make("thread-two"),
      environmentId: environmentTwo,
      projectId: projectTwo,
      title: "Thread two",
    };
    const wrongEnvironment = {
      id: ThreadId.make("thread-wrong-environment"),
      environmentId: environmentTwo,
      projectId: projectOne,
      title: "Wrong environment",
    };

    const branches = buildSidebarProjectThreadBranches({
      projectGroups: [projectGroup],
      threads: [threadOne, threadTwo, wrongEnvironment],
    });

    expect(branches).toHaveLength(1);
    expect(branches[0]?.members.map((member) => member.threads.map((thread) => thread.id))).toEqual(
      [[threadOne.id], [threadTwo.id], []],
    );
  });

  it("prefers a supplied Zerops project name and keeps truthful fallback labels", () => {
    const branches = buildSidebarProjectThreadBranches({
      projectGroups: [projectGroup],
      threads: [],
      zeropsProjectNameByEnvironment: new Map([[environmentOne, "Zerops Acme Dev"]]),
    });

    expect(branches[0]?.members.map((member) => member.displayName)).toEqual([
      "Zerops Acme Dev",
      "dev-two",
      "worker",
    ]);
    expect(branches[0]?.members.map((member) => member.workspaceLabel)).toEqual([
      "www",
      "app",
      "worker",
    ]);
  });
});
