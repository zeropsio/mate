// @effect-diagnostics nodeBuiltinImport:off -- kernel fixtures for the server-to-notice regression.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AtomRegistry } from "effect/reactivity";
import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, type MateHealth } from "@t3tools/contracts";
import { makeAccountStore, mateHealth, mateHealthCopy } from "@t3tools/client-runtime/data";
import { mateHealthScope } from "../../../../../packages/client-runtime/src/data/families/mateHealth.ts";
import { makeCpuSampler } from "../../../../server/src/zerops/mateCpuHealth.ts";
import { readResourceHealth } from "../../../../server/src/zerops/mateResourceHealth.ts";
import { MateHealthMessage } from "../../../src/components/zerops/MateHealthNotice.tsx";

describe("Server resource verdict at the visible notice", () => {
  it.each([
    {
      sentence:
        "A server-reported short memory stall with full swap reaches the notice as critical",
      files: {
        "memory.pressure": "some avg10=5 total=300\nfull avg10=0 total=0\n",
        "memory.swap.current": "2048",
      },
      resources: ["memory"],
      severity: "critical",
      title: "is short of memory — work may be slow",
    },
    {
      sentence: "Growing reclaim events reach the memory notice",
      files: { "memory.events": "high 1\nmax 0\noom 0\noom_kill 0\n" },
      resources: ["memory"],
      severity: "warning",
      title: "is short of memory — work may be slow",
    },
    {
      sentence: "Growing hard-limit events reach the memory notice",
      files: { "memory.events": "high 0\nmax 1\noom 0\noom_kill 0\n" },
      resources: ["memory"],
      severity: "warning",
      title: "is short of memory — work may be slow",
    },
    {
      sentence: "Growing swap reaches the memory notice",
      files: { "memory.swap.current": "1024" },
      resources: ["memory"],
      severity: "warning",
      title: "is short of memory — work may be slow",
    },
    {
      sentence: "Failed allocations without a kill reach the notice as critical",
      files: { "memory.events": "high 0\nmax 0\noom 1\noom_kill 0\n" },
      resources: ["memory"],
      severity: "critical",
      title: "is short of memory — work may be slow",
    },
    {
      sentence: "Short I/O stalls reach the notice without sustained averages",
      files: { "io.pressure": "some avg10=5 total=300\nfull avg10=0 total=0\n" },
      resources: ["io"],
      severity: "warning",
      title: "is slowed by I/O stalls",
    },
    {
      sentence: "Current CPU saturation reaches the notice without sustained averages",
      files: {
        "cpu.pressure": "some avg10=20 total=400000\n",
        "cpu.stat": "usage_usec 3800000\nnr_throttled 0\n",
      },
      resources: ["cpu"],
      severity: "warning",
      title: "is under CPU pressure",
    },
    {
      sentence: "Concurrent owner resources retain their order and all actions",
      files: {
        "memory.events": "high 1\nmax 0\noom 0\noom_kill 0\n",
        "io.pressure": "some avg10=5 total=300\nfull avg10=0 total=0\n",
      },
      resources: ["memory", "io"],
      severity: "warning",
      title: "is short of memory — work may be slow",
    },
  ])("$sentence", async ({ files, resources, severity, title }) => {
    const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "mate-health-notice-"));
    const registry = AtomRegistry.make();
    const store = makeAccountStore(registry);
    try {
      await Promise.all(
        Object.entries({
          "memory.current": "100",
          "memory.high": "max",
          "memory.max": "max",
          "memory.events": "high 0\nmax 0\noom 0\noom_kill 0\n",
          "memory.swap.current": "0",
          "memory.swap.max": "2048",
          "memory.pressure": "some avg10=0 total=0\nfull avg10=0 total=0\n",
          "io.pressure": "some avg10=0 total=0\nfull avg10=0 total=0\n",
          "cpu.pressure": "some avg10=0 total=0\nfull avg10=0 total=0\n",
          "cpu.max": "max 100000",
          "cpuset.cpus.effective": "0-1",
          "cpu.stat": "usage_usec 0\nnr_throttled 0\n",
        }).map(([file, value]) => NodeFSP.writeFile(NodePath.join(dir, file), value)),
      );
      let now = 0;
      const cpu = makeCpuSampler([dir], { nowUsec: () => now, procRoot: dir, ticksPerSecond: 100 });
      const previous = await readResourceHealth([dir], dir, undefined, cpu);
      await Promise.all(
        Object.entries(files).map(([file, value]) =>
          NodeFSP.writeFile(NodePath.join(dir, file), value),
        ),
      );
      now = 2_000_000;
      const evidence = await readResourceHealth([dir], dir, previous, cpu);
      expect(evidence).toMatchObject({ status: "strained", resources, severity });
      const value: MateHealth = {
        source: {
          environmentId: EnvironmentId.make("env"),
          epoch: 1,
          incarnation: "run",
          revision: 1,
        },
        sampledAt: "2026-10-07T12:00:00Z",
        evidence,
      };
      store.dispatch({
        kind: "rows",
        scope: mateHealthScope("toby"),
        generation: 0,
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
      const read = registry.get(
        store.data.project(mateHealth, { orgId: "org", projectId: "toby" }),
      );
      const text = renderToStaticMarkup(createElement(MateHealthMessage, { name: "Toby", read }));
      expect(text).toContain(title);
      expect(mateHealthCopy("Toby", read)?.severity).toBe(severity);
      if (resources.includes("io")) expect(text).toContain("Reduce container disk activity");
      if (resources.includes("cpu"))
        expect(text).toContain("1.9 CPU cores used out of a limit of 2");
      await Promise.all(
        ["memory.pressure", "io.pressure"].map((file) =>
          NodeFSP.writeFile(
            NodePath.join(dir, file),
            "some avg10=0 total=300\nfull avg10=0 total=0\n",
          ),
        ),
      );
      now = 4_000_000;
      const recovered = await readResourceHealth([dir], dir, evidence, cpu);
      expect(recovered).toMatchObject({ status: "ok", resources: [] });
      const next: MateHealth = {
        ...value,
        source: { ...value.source, revision: 2 },
        evidence: recovered,
      };
      store.dispatch({
        kind: "rows",
        scope: mateHealthScope("toby"),
        generation: 0,
        method: "push",
        via: "mate-direct",
        rows: [
          {
            family: "mateHealth",
            id: "toby",
            revision: { kind: "mate-attention", ...next.source, live: true },
            value: next,
          },
        ],
      });
      expect(
        renderToStaticMarkup(
          createElement(MateHealthMessage, {
            name: "Toby",
            read: registry.get(store.data.project(mateHealth, { orgId: "org", projectId: "toby" })),
          }),
        ),
      ).toBe("");
    } finally {
      store.close();
      registry.dispose();
      await NodeFSP.rm(dir, { recursive: true, force: true });
    }
  });
});
