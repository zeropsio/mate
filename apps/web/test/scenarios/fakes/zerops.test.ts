// @effect-diagnostics nodeBuiltinImport:off -- wire-level fidelity tests use real loopback sockets.
import { describe, it, expect } from "vite-plus/test";
import { WebSocket } from "ws";
import { emptyWorld } from "../../../../hq/test/harness/zeropsFake.ts";
import { serve, deadline } from "../harness/http.ts";
import { ZeropsFake } from "./zerops.ts";

async function rig() {
  const world = emptyWorld();
  world.tokens.set("personal", {
    id: "personal",
    name: "personal",
    orgId: "ORG",
    roleCode: "OWNER",
    canCreateProjects: false,
    canViewFinances: false,
    canEditFinances: false,
    projects: [],
    createdMs: 0,
    createdByUser: "owner",
  });
  const fake = new ZeropsFake(world);
  const server = await serve(fake.handle, fake.socket);
  const call = (path: string, body?: unknown) =>
    fetch(`${server.origin}/api/rest/public${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: "Bearer personal", "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return { fake, server, call };
}

async function receiver(origin: string, id: string) {
  const ws = new WebSocket(
    `${origin.replace("http:", "ws:")}/api/rest/public/web-socket/${id}/personal`,
  );
  const messages: { type: string; subscriptionName?: string; data: Record<string, unknown> }[] = [];
  let changed = () => {};
  ws.on("message", (raw) => {
    messages.push(JSON.parse(raw.toString()));
    changed();
  });
  await deadline(
    new Promise<void>((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    }),
    "open receiver",
  );
  const take = async () => {
    if (!messages.length)
      await deadline(
        new Promise<void>((resolve) => {
          changed = resolve;
        }),
        "next frame",
      );
    return messages.shift()!;
  };
  const close = () =>
    deadline(
      new Promise<void>((resolve) => {
        ws.once("close", () => resolve());
        ws.close();
      }),
      "close receiver",
    );
  expect((await take()).type).toBe("SocketSuccess");
  return { ws, messages, take, close };
}

describe("Zerops fake: measured wire guarantees", () => {
  it("accepts a personal token, org-wide filters, full versioned rows and membership-first delivery; reconnect registers current state", async () => {
    const { fake, server, call } = await rig();
    try {
      expect(await (await call("/web-socket/login", { token: "personal" })).json()).toEqual({
        webSocketToken: "personal",
      });
      expect(
        (
          await fetch(`${server.origin}/api/rest/public/web-socket/login`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ token: "personal" }),
          })
        ).status,
      ).toBe(200);
      fake.put("process", {
        id: "build",
        clientId: "ORG",
        projectId: "Ada",
        status: "RUNNING",
        name: "Build",
        executorTag: "USER",
      });
      const first = await receiver(server.origin, "first");
      const register = (receiverId: string, output: string) =>
        call("/process/search", {
          receiverId,
          subscriptionName: output,
          wsOutputType: output,
          disableOutput: output === "updateStream",
          search: [
            { name: "clientId", operator: "eq", value: "ORG" },
            { name: "status", operator: "in", value: ["PENDING", "RUNNING"] },
            { name: "executorTag", operator: "ne", value: "L7_MASTER" },
          ],
        });
      expect(await (await register("first", "listStream")).json()).toMatchObject({
        items: [{ id: "build" }],
      });
      await register("first", "updateStream");
      fake.put(
        "process",
        {
          id: "next",
          clientId: "ORG",
          projectId: "Bea",
          status: "RUNNING",
          name: "Next",
          executorTag: "USER",
        },
        "membership-first",
      );
      expect((await first.take()).data).toEqual({ add: ["next"], delete: [] });
      const row = (await first.take()).data.update as {
        id: string;
        name: string;
        _version: number;
      }[];
      expect(row[0]).toMatchObject({ id: "next", name: "Next", _version: 2 });
      fake.put("process", {
        id: "next",
        clientId: "ORG",
        projectId: "Bea",
        status: "RUNNING",
        name: "Changed",
        executorTag: "USER",
      });
      expect(((await first.take()).data.update as { _version: number }[])[0]?._version).toBe(3);
      fake.put("process", { id: "build", clientId: "ORG", status: "FINISHED" });
      expect((await first.take()).data).toEqual({ add: [], delete: ["build"] });
      await first.close();
      fake.put("process", { id: "offline", clientId: "ORG", status: "RUNNING" });
      const second = await receiver(server.origin, "second");
      expect(second.messages).toEqual([]);
      expect(fake.subscriptions.size).toBe(0);
      const response = await register("second", "listStream");
      expect((await response.json()).items).toHaveLength(2);
      expect(second.messages).toEqual([]);
      expect(fake.registrations.get("process:listStream")).toBe(2);
      expect(fake.requestsByKind.get("process")).toBe(3);
      await second.close();
    } finally {
      await server.close();
    }
  });

  it.each([401, 403, 404, 429, 500, 503] as const)(
    "returns configurable %s, with Retry-After on 429",
    async (status) => {
      const { fake, server, call } = await rig();
      try {
        fake.faults.set("GET /user/info", { status, retryAfter: 7 });
        const response = await call("/user/info");
        expect(response.status).toBe(status);
        if (status === 429) expect(response.headers.get("retry-after")).toBe("7");
      } finally {
        await server.close();
      }
    },
  );

  it.each(["timeout", "silence"] as const)(
    "leaves a %s unanswered until its caller cancels",
    async (mode) => {
      const { fake, server } = await rig();
      try {
        fake.faults.set("GET /user/info", { [mode]: true });
        const controller = new AbortController();
        let settled = false;
        const pending = fetch(`${server.origin}/api/rest/public/user/info`, {
          headers: { authorization: "Bearer personal" },
          signal: controller.signal,
        }).finally(() => {
          settled = true;
        });
        // Install the rejection observer before cancellation, without guessing network admission time.
        const aborted = expect(pending).rejects.toMatchObject({ name: "AbortError" });
        await fake.waitForRequest("GET /user/info");
        fake.clock.advance(60_000);
        expect(settled).toBe(false);
        controller.abort();
        await aborted;
      } finally {
        await server.close();
      }
    },
  );

  it("releases configured latency only when fake time advances", async () => {
    const { fake, server, call } = await rig();
    try {
      // Start directly at the HTTP driver boundary so advancing follows admission without a race.
      fake.faults.set("GET /user/info", { latency: 5000 });
      const pending = fake.handle({
        method: "GET",
        url: new URL("http://localhost/api/rest/public/user/info"),
        headers: { authorization: "Bearer personal" },
        body: {},
      });
      fake.clock.advance(5000);
      expect((await pending)?.body).toMatchObject({ id: "owner" });
      fake.faults.delete("GET /user/info");
      expect((await call("/user/info")).status).toBe(200);
    } finally {
      await server.close();
    }
  });
});
