import { WebSocket } from "ws";
import { expect, it } from "vite-plus/test";
import { emptyWorld } from "../../../../../hq/test/harness/zeropsFake.ts";
import { ZeropsFake } from "../zerops.ts";
import { observeBrowserBudget } from "./browserBudget.ts";
import { deadline, serve } from "../../harness/http.ts";

// Catches HQ platform reads or browser preflights inflating the startup budget.
it("settles and counts browser registrations and other requests while excluding Core credentials", async () => {
  const world = emptyWorld();
  const personal = {
    id: "personal",
    name: "personal",
    orgId: "ORG",
    roleCode: "OWNER" as const,
    canCreateProjects: false,
    canViewFinances: false,
    canEditFinances: false,
    projects: [],
    createdMs: 0,
    createdByUser: "owner",
  };
  world.tokens.set("personal", personal);
  world.tokens.set("hq", { ...personal, id: "hq" });
  const fake = new ZeropsFake(world);
  fake.people.set("personal", "owner");
  const core = await serve(fake.handle, fake.socket);
  const browser = await observeBrowserBudget(fake);
  const call = (origin: string, path: string, method: string, token?: string, body?: unknown) =>
    fetch(`${origin}/api/rest/public${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  let receiver: WebSocket | undefined;
  try {
    await call(browser.origin, "/project/search", "POST", "personal", {
      wsOutputType: "listStream",
      subscriptionName: "menu",
      receiverId: "browser",
      search: [],
    });
    await call(browser.origin, "/user/info", "GET", "personal");
    const { webSocketToken } = await (
      await call(browser.origin, "/web-socket/login", "POST", undefined, { token: "personal" })
    ).json();
    let ready = false;
    const settled = browser.settled().then(() => {
      ready = true;
    });
    await Promise.resolve();
    expect(ready, "A registered receiver must finish connecting before sampling").toBe(false);
    receiver = new WebSocket(
      `${browser.origin.replace("http:", "ws:")}/api/rest/public/web-socket/browser/${webSocketToken}`,
    );
    await deadline(
      new Promise<void>((resolve, reject) => {
        receiver!.once("open", resolve);
        receiver!.once("error", reject);
      }),
      "browser receiver open",
    );
    await settled;
    await call(browser.origin, "/project/search", "OPTIONS");
    await call(core.origin, "/project/HQ1", "GET", "hq");
    await browser.settled();
    expect(browser.sample()).toEqual({ requests: 3, registrations: 1, otherRequests: 2 });
    expect(fake.requestsByCredential.get("hq")?.get("GET /project/HQ1")).toBe(1);
  } finally {
    receiver?.terminate();
    await browser.close();
    await core.close();
  }
});
