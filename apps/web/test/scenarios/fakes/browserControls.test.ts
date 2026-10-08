// @effect-diagnostics nodeBuiltinImport:off -- browser boundary controls against a tiny loopback document.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it, vi } from "vite-plus/test";
import { openBrowser, clickText } from "../harness/browser.ts";
import { completedHttp } from "../harness/completedHttp.ts";
import { MateFake } from "./mate.ts";
import { AuthSessionState, AuthStandardClientScopes } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

const decodeSessionState = Schema.decodeUnknownSync(AuthSessionState);

it("a Mate answers the browser's authenticated session read, including its preflight", async () => {
  const { serve } = await import("../harness/http.ts");
  const dist = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "scenario-session-"));
  await NodeFSP.writeFile(dist + "/index.html", "<!doctype html><title>Session read</title>");
  const mate = new MateFake("Ada", "Ada");
  const methods: string[] = [];
  const api = await serve((request) => {
    methods.push(request.method);
    return mate.handle(request);
  });
  const web = await openBrowser(dist, { "https://mate.example.test": api.origin });
  try {
    await web.page.goto(web.origin);
    const result = await web.page.evaluate(async () => {
      const response = await fetch("https://mate.example.test/mate/api/auth/session", {
        headers: { Authorization: "Bearer scenario-session" },
      });
      return { status: response.status, body: (await response.json()) as unknown };
    });
    expect(methods).toEqual(["OPTIONS", "GET"]);
    expect(result.status).toBe(200);
    expect(decodeSessionState(result.body)).toMatchObject({
      authenticated: true,
      sessionMethod: "bearer-access-token",
      scopes: AuthStandardClientScopes,
    });
  } finally {
    await web.close();
    await api.close();
    await NodeFSP.rm(dist, { recursive: true, force: true });
  }
});

it("manual client timers cross Retry-After/backoff deadlines and coalesce timers across sleep/wake", async () => {
  const dist = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "scenario-clock-"));
  await NodeFSP.writeFile(
    NodePath.join(dist, "index.html"),
    "<!doctype html><title>Clock driver</title>",
  );
  const web = await openBrowser(dist, {});
  try {
    const clock = web.clock(web.page);
    await clock.install();
    await web.page.goto(web.origin);
    await web.page.evaluate(() => {
      const receipts: number[] = [];
      Object.assign(window, { receipts, started: Date.now() });
      setTimeout(() => {
        receipts.push(Date.now());
        setTimeout(() => receipts.push(Date.now()), 2000);
      }, 7000);
    });
    await clock.advance(6999);
    expect(
      await web.page.evaluate(() => (window as unknown as { receipts: number[] }).receipts),
    ).toEqual([]);
    await clock.advance(3001);
    expect(
      await web.page.evaluate(() => {
        const state = window as unknown as { receipts: number[]; started: number };
        return state.receipts.map((at) => at - state.started);
      }),
    ).toEqual([7000, 9000]);
    await web.page.evaluate(() => {
      const state = window as unknown as { receipts: number[] };
      const id = setInterval(() => state.receipts.push(Date.now()), 1000);
      setTimeout(() => clearInterval(id), 60_000);
    });
    await clock.sleep();
    await clock.wake(3_600_000);
    expect(
      await web.page.evaluate(() => (window as unknown as { receipts: number[] }).receipts.length),
    ).toBe(3);
    expect(web.pageErrors).toEqual([]);
  } finally {
    await web.close();
    await NodeFSP.rm(dist, { recursive: true, force: true });
  }
});

it.each(["held reply", "default HTTP settling"])(
  "settles retry replies between timer deadlines (%s), including response-driven backoff",
  async (mode) => {
    const { serve, deadline } = await import("../harness/http.ts");
    const dist = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "scenario-stepped-clock-"));
    await NodeFSP.writeFile(
      NodePath.join(dist, "index.html"),
      "<!doctype html><title>Stepped clock</title>",
    );
    let admitted = () => {};
    const requested = new Promise<void>((resolve) => {
      admitted = resolve;
    });
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let requests = 0;
    const api = await serve(async () => {
      if (++requests === 1) {
        admitted();
        if (mode === "held reply") await held;
        return {
          status: 429,
          headers: { "Retry-After": "2", "Access-Control-Expose-Headers": "Retry-After" },
          body: { retry: true },
        };
      }
      return { body: { done: true } };
    });
    const web = await openBrowser(dist, { "https://retry.example.test": api.origin });
    const settledHttp = completedHttp(web.page);
    try {
      const clock = web.clock(web.page);
      await clock.install();
      await web.page.goto(web.origin);
      await web.page.evaluate(() => {
        const events: [string, number, boolean?][] = [];
        const started = Date.now();
        let complete = false;
        const retry = async () => {
          const response = await fetch("https://retry.example.test/retry");
          await response.json();
          events.push([`reply-${response.status}`, Date.now() - started]);
          if (response.status === 429)
            setTimeout(() => void retry(), Number(response.headers.get("Retry-After")) * 1000);
          else complete = true;
        };
        Object.assign(window, { events });
        setTimeout(() => void retry(), 1000);
        setTimeout(() => events.push(["deadline", Date.now() - started, complete]), 4000);
      });
      const settle = async () => {
        await deadline(requested, "retry admission");
        release();
        await settledHttp();
        await web.page.waitForFunction(
          (count) =>
            (window as unknown as { events: [string, number, boolean?][] }).events.filter(
              ([name]) => name.startsWith("reply-"),
            ).length === count,
          { timeout: 10_000, polling: "raf" },
          requests,
        );
      };
      await clock.advanceStepped(5000, mode === "held reply" ? { settle } : {});
      expect(
        await web.page.evaluate(() => (window as unknown as { events: unknown[] }).events),
      ).toEqual([
        ["reply-429", 1000],
        ["reply-200", 3000],
        ["deadline", 4000, true],
      ]);
      expect(requests).toBe(2);
    } finally {
      release();
      await web.close();
      await api.close();
      await NodeFSP.rm(dist, { recursive: true, force: true });
    }
  },
);

it("clicking visible text reacquires a row replaced during the browser's clickability check", async () => {
  const dist = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "scenario-click-"));
  await NodeFSP.writeFile(
    NodePath.join(dist, "index.html"),
    '<!doctype html><button data-zerops-surface="click-test">Open Mate</button>',
  );
  const web = await openBrowser(dist, {});
  try {
    await web.page.goto(web.origin);
    await web.page.evaluate(() => {
      const original = document.querySelector<HTMLButtonElement>(
        '[data-zerops-surface="click-test"]',
      )!;
      const bounds = original.getBoundingClientRect.bind(original);
      let reads = 0;
      Object.defineProperty(original, "getBoundingClientRect", {
        value: () => {
          const rectangle = bounds();
          if (++reads === 2) {
            const replacement = original.cloneNode(true) as HTMLButtonElement;
            replacement.addEventListener("click", () => {
              replacement.innerText = "Mate opened";
            });
            original.replaceWith(replacement);
          }
          return rectangle;
        },
      });
    });
    await clickText(web.page, "click-test", "Open Mate");
    expect(await web.page.evaluate(() => document.body.innerText)).toBe("Mate opened");
  } finally {
    await web.close();
    await NodeFSP.rm(dist, { recursive: true, force: true });
  }
});

it.each(["fetch", "file upload"] as const)(
  "forwards %s bytes without decoding them as text",
  async (mode) => {
    const { serve } = await import("../harness/http.ts");
    const dist = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "scenario-upload-"));
    await NodeFSP.writeFile(
      NodePath.join(dist, "index.html"),
      "<!doctype html><title>Upload</title>",
    );
    const api = await serve((request) =>
      request.method === "POST"
        ? { body: { bytes: [...(request.rawBody ?? [])] } }
        : { status: 204 },
    );
    const web = await openBrowser(dist, { "https://upload.example.test": api.origin });
    try {
      await web.page.goto(web.origin);
      const bytes = [0, 255, 128, 240, 159, 146, 169, 13, 10];
      const result = await web.page.evaluate(
        async (bytes, mode) => {
          if (mode === "file upload")
            return new Promise<{ bytes: number[] }>((resolve, reject) => {
              const xhr = new XMLHttpRequest();
              xhr.open("POST", "https://upload.example.test/file");
              xhr.setRequestHeader("Content-Type", "application/octet-stream");
              xhr.onload = () => resolve(JSON.parse(xhr.responseText));
              xhr.onerror = reject;
              xhr.send(
                new File([new Uint8Array(bytes)], "file.bin", { type: "application/octet-stream" }),
              );
            });
          const response = await fetch("https://upload.example.test/file", {
            method: "POST",
            headers: { "Content-Type": "application/octet-stream" },
            body: new Uint8Array(bytes),
          });
          return response.json() as Promise<{ bytes: number[] }>;
        },
        bytes,
        mode,
      );
      expect(result.bytes).toEqual(bytes);
      expect(web.pageErrors).toEqual([]);
    } finally {
      await web.close();
      await api.close();
      await NodeFSP.rm(dist, { recursive: true, force: true });
    }
  },
);

it("filtered HTTP settling waits for an actual new document while navigation is held", async () => {
  const { serve, deadline } = await import("../harness/http.ts");
  const dist = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "scenario-navigation-"));
  await NodeFSP.writeFile(
    NodePath.join(dist, "index.html"),
    "<!doctype html><title>Old document</title>",
  );
  let bodyAsked = () => {};
  const bodyRequest = new Promise<void>((resolve) => {
    bodyAsked = resolve;
  });
  let navigationAsked = () => {};
  const navigationRequest = new Promise<void>((resolve) => {
    navigationAsked = resolve;
  });
  let releaseBody = () => {};
  const heldBody = new Promise<void>((resolve) => {
    releaseBody = resolve;
  });
  let releaseNavigation = () => {};
  const heldNavigation = new Promise<void>((resolve) => {
    releaseNavigation = resolve;
  });
  const api = await serve(async ({ url }) => {
    if (url.pathname === "/held-body") {
      bodyAsked();
      await heldBody;
      return { body: { done: true } };
    }
    navigationAsked();
    await heldNavigation;
    return { html: "<!doctype html><title>New document</title>" };
  });
  const web = await openBrowser(dist, { "https://navigation.example.test": api.origin });
  const settle = completedHttp(web.page, (request) => request.url().endsWith("/held-body"));
  try {
    await web.page.goto(web.origin);
    await web.page.evaluate(() => {
      void fetch("https://navigation.example.test/held-body").catch(() => {});
    });
    await deadline(bodyRequest, "old document body requested");
    const evaluate = vi.spyOn(web.page, "evaluate");
    const drained = settle();
    const cleanupDrained = Promise.allSettled([drained]);
    const navigation = web.page.goto("https://navigation.example.test/landing");
    try {
      await deadline(navigationRequest, "new document navigation requested");
      expect(evaluate, "A held navigation must not enter the old renderer").not.toHaveBeenCalled();
      releaseNavigation();
      await navigation;
      await drained;
      expect(await web.page.title()).toBe("New document");
    } finally {
      releaseNavigation();
      releaseBody();
      await Promise.allSettled([navigation, cleanupDrained]);
      evaluate.mockRestore();
    }
  } finally {
    releaseNavigation();
    releaseBody();
    settle.close();
    await web.close();
    await api.close();
    await NodeFSP.rm(dist, { recursive: true, force: true });
  }
});
