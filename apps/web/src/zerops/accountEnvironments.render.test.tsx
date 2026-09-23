import type { AccountEnvironments } from "@t3tools/client-runtime/zerops/account/runtime";
import type {
  ContainerMachine,
  EnvironmentMachine,
  TargetKey,
} from "@t3tools/client-runtime/zerops/environments";
import { Profiler } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { TestNode } from "./__fixtures__/testDom";

function installTestDom(): TestNode {
  const document = new TestNode("#document", null, 9);
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", {
    document,
    HTMLIFrameElement: TestNode,
    addEventListener() {},
    removeEventListener() {},
  });
  vi.stubGlobal("HTMLIFrameElement", TestNode);
  return document;
}

const nextMacrotask = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A post-grant stage whose machines the test replaces, publishing each replacement. */
function publishingStage() {
  let machines: ReadonlyMap<TargetKey, EnvironmentMachine> = new Map();
  let containers: ReadonlyMap<TargetKey, ContainerMachine> = new Map();
  const listeners = new Set<() => void>();
  const stage = {
    machines: () => machines,
    containers: () => containers,
    records: () => [],
    index: () => ({ serving: new Map(), reported: new Map(), unanswered: [], failed: [] }),
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  } as unknown as AccountEnvironments;
  const publish = () => {
    for (const listener of listeners) listener();
  };
  return {
    stage,
    subscribed: () => listeners.size > 0,
    /** One Mate's environment machine moves on. */
    environment: (key: TargetKey) => {
      machines = new Map([...machines, [key, {} as EnvironmentMachine]]);
      publish();
    },
    /** One Mate's container machine moves on. */
    container: (key: TargetKey) => {
      containers = new Map([...containers, [key, {} as ContainerMachine]]);
      publish();
    },
    size: () => ({ machines: machines.size, containers: containers.size }),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the post-grant stage as React reads it", () => {
  // After a lapse, the grant reconnects every Mate at once: each target's environment and
  // container machine publish on their own, microtask by microtask, all within one task. React
  // commits each publication it hears on its own, and a surface that schedules an update in a
  // commit then counts every one of them as nested (limit 50).
  it("a burst of publications from twelve reconnecting Mates in one task is one commit", async () => {
    const document = installTestDom();
    const { createRoot } = await import("react-dom/client");
    const { bindAccountEnvironments, useContainerMachines, useEnvironmentMachines } =
      await import("./accountEnvironments");
    const rig = publishingStage();
    const unbind = bindAccountEnvironments(rig.stage);
    let rendered = { machines: -1, containers: -1 };
    let commits = 0;

    function Surface() {
      rendered = {
        machines: useEnvironmentMachines().size,
        containers: useContainerMachines().size,
      };
      return null;
    }

    const root = createRoot(document.createElement("div") as unknown as Element);
    try {
      root.render(
        <Profiler id="surface" onRender={() => void (commits += 1)}>
          <Surface />
        </Profiler>,
      );
      while (!rig.subscribed()) await nextMacrotask();
      commits = 0;

      for (let mate = 1; mate <= 12; mate += 1) {
        for (let step = 0; step < 4; step += 1) {
          rig.environment(`project-${mate}:zcp`);
          await Promise.resolve();
          rig.container(`project-${mate}:zcp`);
          await Promise.resolve();
        }
      }
      // The next task tells the surface; a timer's task may come first.
      await vi.waitFor(() => expect(commits).toBeGreaterThan(0));
      await nextMacrotask();

      expect(commits).toBe(1);
      expect(rendered).toEqual(rig.size());
    } finally {
      root.unmount();
      unbind();
      await nextMacrotask();
    }
  });
});
