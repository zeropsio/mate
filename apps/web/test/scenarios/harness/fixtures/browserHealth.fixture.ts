// @effect-diagnostics nodeBuiltinImport:off -- deliberately unhealthy browsers in isolated child runs.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterAll, expect, it } from "vite-plus/test";
import { openBrowser } from "../browser.ts";
import { deadline } from "../http.ts";

const targets: { name: string; reached: boolean }[] = [];
afterAll(() => {
  for (const target of targets)
    expect(target.reached, `Health fixture did not reach its receipt: ${target.name}`).toBe(true);
});
function target(name: string) {
  const receipt = { name, reached: false };
  targets.push(receipt);
  return () => {
    receipt.reached = true;
  };
}

async function withBrowser(run: (web: Awaited<ReturnType<typeof openBrowser>>) => Promise<void>) {
  const dist = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "scenario-health-"));
  await NodeFSP.writeFile(
    NodePath.join(dist, "index.html"),
    "<!doctype html><title>Health fixture</title>",
  );
  const web = await openBrowser(dist, {});
  try {
    await web.page.goto(web.origin);
    await run(web);
  } finally {
    await web.close();
    await NodeFSP.rm(dist, { recursive: true, force: true });
  }
}

it("clean filtered browser", () => withBrowser(async () => {}));
it.fails("expected failure with uncaught page error", () => {
  const arrived = target("uncaught page error");
  return withBrowser(async ({ page }) => {
    const received = deadline(
      new Promise<void>((resolve) => page.once("pageerror", () => resolve())),
      "uncaught page error receipt",
    );
    await page.evaluate(() => {
      setTimeout(() => {
        throw new Error("health-regression-page-error");
      }, 0);
    });
    await received;
    arrived();
    throw new Error("expected domain failure");
  });
});
it.fails("expected failure with unmapped HTTP", () => {
  const arrived = target("unmapped HTTP");
  return withBrowser(async (web) => {
    await web.page.evaluate(async () => {
      await fetch("https://unmapped.example.test/request").catch(() => {});
    });
    await deadline(web.networkViolation, "blocked HTTP receipt");
    arrived();
    throw new Error("expected domain failure");
  });
});
it.fails("expected failure with unmapped WebSocket", () => {
  const arrived = target("unmapped WebSocket");
  return withBrowser(async (web) => {
    await web.page.evaluate(() => {
      try {
        const socket = new WebSocket("wss://unmapped.example.test/socket");
        socket.close();
      } catch {
        /* Deliberately caught by a hypothetical client. */
      }
    });
    await deadline(web.networkViolation, "blocked WebSocket receipt");
    arrived();
    throw new Error("expected domain failure");
  });
});
