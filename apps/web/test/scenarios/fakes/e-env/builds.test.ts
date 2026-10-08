// @effect-diagnostics nodeBuiltinImport:off globalFetch:off -- loopback wire fidelity tests.
import { describe, expect, it } from "vite-plus/test";
import { emptyWorld } from "../../../../../hq/test/harness/zeropsFake.ts";
import { serve } from "../../harness/http.ts";
import { ZeropsFake } from "../zerops.ts";
import { definePerson } from "../zeropsWorld.ts";
import { installBuildProtocol, endBuild } from "./builds.ts";

describe("E build protocol fidelity", () => {
  // Catches a fake build that cannot light the real client's activity or falsely completes on read.
  it("names a running stack.build and changes only at an explicit terminal receipt", async () => {
    const fake = new ZeropsFake(emptyWorld());
    definePerson(fake.world, "owner", { role: "OWNER" });
    fake.put("project", { id: "Stage", name: "Stage", clientId: "ORG" });
    fake.put("service-stack", {
      id: "web",
      name: "web",
      projectId: "Stage",
      clientId: "ORG",
      status: "ACTIVE",
    });
    installBuildProtocol(fake);
    const server = await serve(fake.handle, fake.socket);
    const call = (path: string, method = "GET", body?: string) =>
      fetch(`${server.origin}/api/rest/public${path}`, {
        method,
        headers: {
          authorization: "Bearer personal",
          "content-type": path.endsWith("/upload")
            ? "application/octet-stream"
            : "application/json",
        },
        ...(body === undefined ? {} : { body }),
      });
    try {
      const created = (await (
        await call(
          "/service-stack/web/app-version",
          "POST",
          JSON.stringify({ name: "abc1234 v0.1.0" }),
        )
      ).json()) as { id: string };
      await call(`/app-version/${created.id}/upload`, "PUT", "archive");
      const started = (await (
        await call(
          `/app-version/${created.id}/build-and-deploy`,
          "PUT",
          JSON.stringify({ zeropsYaml: "zerops: []", zeropsYamlSetup: "web" }),
        )
      ).json()) as { id: string };
      expect(await (await call(`/process/${started.id}`)).json()).toMatchObject({
        actionName: "stack.build",
        status: "RUNNING",
        finished: null,
        appVersion: { id: created.id, name: "abc1234 v0.1.0", status: "BUILDING" },
      });
      endBuild(fake, started.id, "FINISHED");
      expect(await (await call(`/process/${started.id}`)).json()).toMatchObject({
        status: "FINISHED",
        appVersion: { status: "ACTIVE" },
      });
      expect(await (await call("/service-stack/web")).json()).toMatchObject({
        activeAppVersion: { id: created.id },
      });
    } finally {
      await server.close();
    }
  });

  // Catches a fake failure removing the previously live version and hiding a real release regression.
  it("failed builds keep the previous active version and expose the failed pipeline", () => {
    const fake = new ZeropsFake(emptyWorld());
    fake.put("project", { id: "Prod", clientId: "ORG", name: "Prod" });
    fake.put("service-stack", {
      id: "web",
      projectId: "Prod",
      clientId: "ORG",
      name: "web",
      activeAppVersion: { id: "old" },
    });
    for (const [id, status] of [
      ["old", "ACTIVE"],
      ["new", "BUILDING"],
    ]) {
      fake.world.appVersions.set(id!, {
        id: id!,
        serviceId: "web",
        name: id!,
        status: status!,
        archive: undefined,
        zeropsYaml: undefined,
        setup: undefined,
      });
      fake.put("app-version", { id: id!, projectId: "Prod", serviceStackId: "web", status });
    }
    const process = fake.writes.start("Prod", "stack.build", ["web"], "new");
    endBuild(fake, process, "FAILED");
    expect(fake.rows("service-stack")[0]?.activeAppVersion).toEqual({ id: "old" });
    expect(fake.world.appVersions.get("old")?.status).toBe("ACTIVE");
    expect(fake.rows("process")[0]).toMatchObject({
      status: "FAILED",
      error: { message: "Storefront build failed" },
      appVersion: { id: "new", status: "BUILD_FAILED", activationDate: null },
    });
  });
});
