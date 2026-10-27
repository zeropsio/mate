// @effect-diagnostics nodeBuiltinImport:off -- real cgroup-v2 file shapes through the composer consumer.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AtomRegistry } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, type MateHealth } from "@t3tools/contracts";
import { makeAccountStore, mateHealth } from "@t3tools/client-runtime/data";
import { linkKeys } from "../../../../packages/client-runtime/src/data/model.ts";
import { mateHealthScope } from "../../../../packages/client-runtime/src/data/families/mateHealth.ts";
import { readResourceHealth } from "../../../server/src/zerops/mateResourceHealth.ts";
import { ComposerBannerStack } from "../../src/components/chat/ComposerBannerStack.tsx";
import { mateHealthBannerItem } from "../../src/components/chat/MateHealthBanner.tsx";

const disk = vi.hoisted(() => ({ full: false }));
vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>();
  return {
    ...fs,
    statfs: async (path: string) => {
      const stat = await fs.statfs(path);
      return disk.full ? { ...stat, bavail: 0 } : stat;
    },
  };
});

// Baseline captured over read-only SSH from Ada on 2026-10-12. Perturb one kernel signal at a time.
const baseline = {
  "memory.current": "100",
  "memory.high": "max",
  "memory.max": "max",
  "memory.events":
    "low 0\nhigh 22830\nmax 0\noom 0\noom_kill 0\noom_group_kill 0\nsock_throttled 11021\n",
  "memory.swap.current": "0",
  "memory.swap.max": "2048",
  "memory.pressure":
    "some avg10=0.00 avg60=0.00 avg300=0.00 total=23849061\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=13008446\n",
  "io.pressure":
    "some avg10=0.00 avg60=0.00 avg300=0.00 total=17190765\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=10213888\n",
  "pids.current": "136",
  "pids.max": "2000",
};
const sustained =
  "some avg10=0.00 avg60=40.00 avg300=40.00 total=23849061\nfull avg10=0.00 avg60=10.00 avg300=10.00 total=13008446\n";
describe("Server resource verdict at the visible notice", () => {
  it.each([
    {
      sentence: "routine scaling stays quiet: memory.high event",
      files: { "memory.events": "high 22831\nmax 0\noom 0\noom_kill 0\n" },
      resources: [],
      title: null,
      action: false,
    },
    {
      sentence: "routine scaling stays quiet: swap growth",
      files: { "memory.swap.current": "1024" },
      resources: [],
      title: null,
      action: false,
    },
    {
      sentence: "routine scaling stays quiet: brief PSI",
      files: {
        "memory.pressure":
          "some avg10=90.00 avg60=1.00 avg300=0.20 total=23849061\nfull avg10=40.00 avg60=1.00 avg300=0.20 total=13008446\n",
        "io.pressure":
          "some avg10=90.00 avg60=1.00 avg300=0.20 total=17190765\nfull avg10=40.00 avg60=1.00 avg300=0.20 total=10213888\n",
      },
      resources: [],
      title: null,
      action: false,
    },
    {
      sentence: "An observed OOM kill reaches the composer",
      files: { "memory.events": "high 22830\nmax 0\noom 1\noom_kill 1\n" },
      resources: ["memory"],
      title: "Toby ran out of memory and the system stopped a process.",
      action: true,
    },
    {
      sentence: "Sustained memory thrashing reaches the composer",
      files: { "memory.pressure": sustained },
      resources: ["memory"],
      title: "Toby has been swapping to disk for 5 minutes — work is slow.",
      action: true,
    },
    {
      sentence: "A full state disk reaches the composer",
      files: {},
      diskFull: true,
      resources: ["disk"],
      title: "Toby's state disk is full.",
      action: true,
    },
    {
      sentence: "Sustained I/O thrashing reaches the composer",
      files: { "io.pressure": sustained },
      resources: ["io"],
      title: "Toby has been waiting on disk for 5 minutes.",
      action: false,
    },
    {
      sentence: "The task-limit boundary reaches the composer",
      files: { "pids.current": "1800" },
      resources: ["pids"],
      title: "Toby is near its process limit — likely leftover browsers.",
      action: false,
    },
    {
      sentence: "Concurrent owner resources retain their order and all actions",
      files: { "memory.pressure": sustained, "io.pressure": sustained, "pids.current": "1800" },
      resources: ["memory", "io", "pids"],
      title: "Toby has been swapping to disk for 5 minutes — work is slow.",
      action: true,
    },
  ])("$sentence", async ({ files, resources, title, action, ...options }) => {
    const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "mate-health-notice-"));
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    try {
      await Promise.all(
        Object.entries(baseline).map(([file, value]) =>
          NodeFSP.writeFile(NodePath.join(dir, file), value),
        ),
      );
      const previous = await readResourceHealth([dir], dir, undefined, 0);
      for (const key of [mateHealthScope("toby"), linkKeys.mateHealth("toby")]) {
        for (const event of [
          { kind: "demand", demanded: true },
          { kind: "attempt" },
          { kind: "handshake" },
          { kind: "baseline-committed" },
        ] as const)
          store.dispatch({ kind: "stream", key, now: 0, event });
      }
      const render = () => {
        const read = registry.get(
          store.data.project(mateHealth, { orgId: "org", projectId: "toby" }),
        );
        const item = mateHealthBannerItem({
          name: "Toby",
          read,
          projectUrl: "https://app.zerops.io/project/toby",
        });
        return renderToStaticMarkup(
          createElement(ComposerBannerStack, { items: item === null ? [] : [item] }),
        );
      };
      expect(render()).toBe(""); // health arrives after first paint
      await Promise.all(
        Object.entries(files).map(([file, value]) =>
          NodeFSP.writeFile(NodePath.join(dir, file), value),
        ),
      );
      disk.full = "diskFull" in options && options.diskFull === true;
      const evidence = await readResourceHealth([dir], dir, previous, 0);
      const publish = (evidence: MateHealth["evidence"], revision: number) => {
        const value: MateHealth = {
          source: {
            environmentId: EnvironmentId.make("env"),
            epoch: 1,
            incarnation: "run",
            revision,
          },
          sampledAt: "2026-10-12T14:00:00Z",
          evidence,
        };
        store.dispatch({
          kind: "rows",
          scope: mateHealthScope("toby"),
          generation: 1,
          method: "push",
          via: "mate-direct",
          rows: [
            {
              family: "mateHealth",
              id: "toby",
              revision: { kind: "mate-attention", ...value.source, live: true },
              value,
            },
          ],
        });
      };
      publish(evidence, 1);
      const text = render();
      if (title === null) expect(text).toBe("");
      else {
        expect(text).toContain(title.replaceAll("'", "&#x27;"));
        expect(text.includes("Open in Zerops")).toBe(action);
        expect(text).not.toContain("Restart Mate");
      }
      expect(evidence.resources).toEqual(resources);
      disk.full = false;
      await Promise.all(
        Object.entries(baseline).map(([file, value]) =>
          NodeFSP.writeFile(NodePath.join(dir, file), value),
        ),
      );
      publish(await readResourceHealth([dir], dir, evidence, 600000), 2);
      expect(render()).toBe("");
    } finally {
      disk.full = false;
      registry.dispose();
      await NodeFSP.rm(dir, { recursive: true, force: true });
    }
  });
});
