import { expect, it } from "vite-plus/test";
import { emptyWorld } from "../../harness/fakeWorld.ts";
import { ZeropsFake } from "../zerops.ts";
import { observeBrowserBudget } from "./browserBudget.ts";
import { serve } from "../../harness/http.ts";

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
  world.tokens.set("personal-dev", { ...personal, id: "personal-dev", createdByUser: "dev" });
  const fake = new ZeropsFake(world);
  fake.people.set("personal", "owner");
  fake.people.set("personal-dev", "dev");
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
  try {
    await call(browser.origin, "/project/search", "POST", "personal", {
      wsOutputType: "listStream",
      subscriptionName: "menu",
      receiverId: "browser",
      search: [],
    });
    await call(browser.origin, "/user/info", "GET", "personal-dev");
    await call(browser.origin, "/web-socket/login", "POST", undefined, { token: "personal" });
    await call(browser.origin, "/project/search", "OPTIONS");
    await call(core.origin, "/project/HQ1", "GET", "personal");
    await browser.settled();
    expect(browser.sample()).toEqual({ requests: 3, registrations: 1, otherRequests: 2 });
    expect(fake.requestsByCredential.get("personal")?.get("GET /project/HQ1")).toBe(1);
    expect(browser.matching(/^GET \/project\/HQ1$/u)).toBe(0);
    expect(browser.matching(/^GET \/user\/info$/u)).toBe(1);
  } finally {
    await browser.close();
    await core.close();
  }
});
