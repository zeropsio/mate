// @effect-diagnostics nodeBuiltinImport:off -- native/page clocks and real loopback HTTP receipts.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "vite-plus/test";
import { seedCoreWorld } from "../../../../hq/test/harness/runningCore.ts";
import { openBrowser } from "../harness/browser.ts";
import { serve } from "../harness/http.ts";
import { ZeropsFake } from "./zerops.ts";

it("process creation and transitions use current fake wall time, with fresh native defaults", () => {
  const fake = new ZeropsFake(seedCoreWorld(Date.now(), true, "ORG"));
  const before = Date.now();
  const id = fake.writes.start("P_MATE", "build", []);
  const process = () => fake.rows("process").find((row) => row.id === id)!;
  const created = process().created;
  expect(Date.parse(String(created))).toBeGreaterThanOrEqual(before);
  expect(Date.parse(String(process().started))).toBeLessThanOrEqual(Date.now());
  const epoch = Date.now() + 10_000;
  fake.clock.setTime(epoch);
  fake.clock.advance(250);
  fake.writes.transition(id, "FINISHED");
  expect(process().created).toBe(created);
  expect(process().finished).toBe(new Date(epoch + 250).toISOString());
  expect(process().lastUpdate).toBe(process().finished);
});

it("a page timer's HTTP write stamps the process at that deadline before later page timers advance", async () => {
  const fake = new ZeropsFake(seedCoreWorld(Date.now(), true, "ORG"));
  let id: string | undefined;
  const api = await serve(async () => {
    id = fake.writes.start("P_MATE", "build", []);
    return { body: { id } };
  });
  const dist = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "scenario-process-clock-"));
  await NodeFSP.writeFile(
    NodePath.join(dist, "index.html"),
    "<!doctype html><title>Process time</title>",
  );
  const web = await openBrowser(dist, { "https://writes.example.test": api.origin }, fake.clock);
  try {
    const clock = web.clock(web.page);
    await clock.install();
    await web.page.goto(web.origin);
    const initial = await web.page.evaluate(() => Date.now());
    expect(fake.clock.currentTimeMillis()).toBe(initial);
    await web.page.evaluate(() => {
      setTimeout(() => void fetch("https://writes.example.test/build"), 1000);
    });
    await clock.advanceStepped(5000);
    expect(id).toBeDefined();
    const process = fake.rows("process").find((row) => row.id === id)!;
    expect(process.created).toBe(new Date(initial + 1000).toISOString());
    expect(process.started).toBe(process.created);
    expect(fake.clock.currentTimeMillis()).toBe(await web.page.evaluate(() => Date.now()));
    expect(fake.clock.currentTimeMillis()).toBe(initial + 5000);
    // Browser advances synchronize timestamp time without expiring fake socket tokens/latency.
    expect(fake.clock.now).toBe(0);
    await web.page.reload();
    expect(await web.page.evaluate(() => Date.now())).toBe(initial + 5000);
    expect(fake.clock.currentTimeMillis()).toBe(initial + 5000);
    fake.writes.transition(id!, "FINISHED");
    expect(fake.rows("process").find((row) => row.id === id)!.finished).toBe(
      new Date(initial + 5000).toISOString(),
    );
  } finally {
    await web.close();
    await api.close();
    await NodeFSP.rm(dist, { recursive: true, force: true });
  }
});
