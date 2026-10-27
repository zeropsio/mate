// @effect-diagnostics globalFetch:off -- localhost HTTP driver proof.
import { describe, expect, it } from "vite-plus/test";
import { seedCoreWorld } from "../../../../../hq/test/harness/runningCore.ts";
import { ZeropsFake } from "../zerops.ts";
import { definePerson } from "../zeropsWorld.ts";
import { serve } from "../../harness/http.ts";
import { replyLossProxy } from "./replyLoss.ts";
import { CreationFake } from "./creation.ts";
import type { WireRequest } from "../../harness/http.ts";

const fixture = () => {
  const fake = new ZeropsFake(seedCoreWorld(Date.now(), true, "ORG"));
  definePerson(fake.world, "owner", { role: "OWNER" });
  const driver = new CreationFake(fake);
  fake.handlers.push(driver.handle);
  const request: WireRequest = {
    method: "POST",
    url: new URL("http://localhost/api/rest/public/client/ORG/project"),
    headers: { authorization: "Bearer personal" },
    body: { name: "Nova", tagList: ["mate"] },
  };
  return { fake, driver, request };
};

describe("creation platform extension", () => {
  it("acceptance publishes the project and its own creation process to the shared inventory", async () => {
    const { fake, driver, request } = fixture();
    const response = await fake.handle(request);
    expect(response?.body).toMatchObject({ id: "created-1", name: "Nova", tagList: ["mate"] });
    expect(fake.world.projects).toContainEqual(
      expect.objectContaining({ id: "created-1", name: "Nova" }),
    );
    expect(fake.rows("process")).toContainEqual(
      expect.objectContaining({
        projectId: "created-1",
        actionName: "project.create",
        status: "FINISHED",
      }),
    );
    expect(driver.accepted).toHaveLength(1);
  });

  it("a definitive refusal creates no project, including a read-only membership", async () => {
    const { fake, driver, request } = fixture();
    definePerson(fake.world, "reader", { role: "READ_ONLY" });
    request.headers.authorization = "Bearer personal-reader";
    expect((await fake.handle(request))?.status).toBe(403);
    expect(driver.accepted).toEqual([]);
    expect(fake.rows("project").some((row) => row.name === "Nova")).toBe(false);
  });

  it("a lost HTTP reply leaves exactly one accepted project", async () => {
    const { fake, driver, request } = fixture();
    const api = await serve(fake.handle, fake.socket);
    fake.origin = api.origin;
    const proxy = await replyLossProxy(fake, driver);
    try {
      driver.outcome = "lost";
      await expect(
        fetch(`${proxy.origin}${request.url.pathname}`, {
          method: "POST",
          headers: { authorization: "Bearer personal", "content-type": "application/json" },
          body: JSON.stringify(request.body),
        }),
      ).rejects.toThrow();
      expect(fake.world.projects.filter((row) => row.name === "Nova")).toHaveLength(1);
      expect(fake.requests.get("POST /client/ORG/project")).toBe(1);
    } finally {
      await proxy.close();
      await api.close();
    }
  });

  it("a failed creation process remains separate from HTTP acceptance", async () => {
    const { fake, driver, request } = fixture();
    driver.creationStatus = "FAILED";
    expect((await fake.handle(request))?.body).toMatchObject({ id: "created-1" });
    expect(fake.rows("process")[0]).toMatchObject({
      status: "FAILED",
      error: { message: "Project capacity exhausted." },
    });
  });

  it("recipe imports publish active services without needing a process read", async () => {
    const { fake, request } = fixture();
    await fake.handle(request);
    const imported = await fake.handle({
      ...request,
      url: new URL("http://localhost/api/rest/public/project/created-1/service-stack/import"),
      body: { yaml: "services:\n  - hostname: api\n    type: nodejs@22\n" },
    });
    expect(imported?.body).toMatchObject({ serviceStacks: [{ name: "api" }] });
    expect(fake.rows("service-stack")).toContainEqual(
      expect.objectContaining({ projectId: "created-1", name: "api", status: "ACTIVE" }),
    );
    expect(fake.rows("process")).toContainEqual(
      expect.objectContaining({
        projectId: "created-1",
        actionName: "service-stack.create",
        status: "FINISHED",
      }),
    );
  });
});
