import type { ScenarioExtension, ScenarioDrivers } from "../../harness/scenario.ts";
import { CreationFake } from "../../fakes/f-create/creation.ts";
import { MateFake } from "../../fakes/mate.ts";
import { replyLossProxy } from "../../fakes/f-create/replyLoss.ts";
import { serve } from "../../harness/http.ts";

type CreationControl = CreationFake & {
  blockIsolation: boolean;
  holdCreation: boolean;
  deleted: string[];
  mateKeys: string[];
};
const controls = new WeakMap<ScenarioDrivers, CreationControl>();
export const creationOf = (drivers: ScenarioDrivers) => {
  const control = controls.get(drivers);
  if (!control) throw new Error("Install f-create before using its driver");
  return control;
};

export const installCreation: ScenarioExtension = async (drivers) => {
  const creation = Object.assign(new CreationFake(drivers.zerops), {
    blockIsolation: false,
    holdCreation: false,
    deleted: [] as string[],
    mateKeys: [] as string[],
  });
  controls.set(drivers, creation);
  drivers.zerops.handlers.push(async (request) => {
    const path = request.url.pathname.replace(/^\/api\/rest\/public/u, "");
    if (
      path === "/client/ORG/integration-token" &&
      request.method === "POST" &&
      typeof request.body.name === "string" &&
      request.body.name.startsWith("zcp-")
    )
      creation.mateKeys.push(request.body.name);
    if (path === "/client/ORG/project" && request.method === "POST") {
      const response = await creation.handle(request);
      if (creation.creationStatus === "FAILED") {
        const project = drivers.zerops.rows("project").find((row) => row.id === "created-1");
        if (project) drivers.zerops.put("project", { ...project, status: "NEW" });
      }
      if (creation.holdCreation) {
        const process = drivers.zerops
          .rows("process")
          .find((row) => row.id === "created-1-creation");
        if (process) drivers.zerops.put("process", { ...process, status: "RUNNING" });
      }
      return response;
    }
    if (
      path === "/project/created-1/first-class-recipe/development-container" &&
      request.method === "PUT"
    ) {
      const response = await creation.handle(request);
      const yaml = String(request.body.serviceImportYaml ?? "");
      const marker = yaml.match(/MATE_SETUP_RUNTIMES: "([^"]+)"/u)?.[1];
      if (marker !== undefined && response?.status === undefined) {
        drivers.zerops.put("user-data", {
          id: "container-created-1-setup",
          projectId: "created-1",
          serviceStackId: "container-created-1",
          clientId: "ORG",
          key: "MATE_SETUP_RUNTIMES",
          content: marker,
        });
      }
      return response;
    }
    const search = request.body.search as { name: string; value: string }[] | undefined;
    if (
      creation.blockIsolation &&
      path === "/project/search" &&
      request.method === "POST" &&
      search?.some((filter) => filter.name === "id" && filter.value === "created-1") &&
      drivers.zerops.rows("service-stack").some((row) => row.projectId === "created-1")
    ) {
      const project = drivers.zerops.rows("project").find((row) => row.id === "created-1");
      if (project) {
        const { envList: _unread, ...partial } = project;
        return { body: { items: [partial] } };
      }
    }
    const target = path.match(/^\/project\/([^/]+)$/u)?.[1];
    if (request.method !== "DELETE" || !target) return undefined;
    if (!creation.accepted.some((project) => project.id === target)) return undefined;
    const credential = request.headers.authorization?.replace(/^Bearer /u, "") ?? "";
    if (!drivers.zerops.canWrite(credential, target))
      return drivers.zerops.error(403, "insufficientPermissions");
    creation.deleted.push(target);
    const processId = drivers.zerops.writes.start(target, "project.delete", []);
    drivers.zerops.remove("project", target);
    drivers.zerops.writes.transition(processId, "FINISHED");
    return { body: { id: processId } };
  });
  drivers.zerops.handlers.push(creation.handle);
  const proxy = await replyLossProxy(drivers.zerops, creation);
  drivers.routes["https://api.app-prg1.zerops.io"] = proxy.origin;
  drivers.cleanup.push(proxy.close);
  // Predictable platform ids allow routes to be installed before any page opens.
  const mate = new MateFake("created-1", "Nova");
  for (const install of drivers.onMate) install(mate);
  drivers.mates.set("created-1", mate);
  const server = await serve(mate.handle, mate.socket);
  drivers.routes["https://zcp-created-1-8080.prg1.zerops.app"] = server.origin;
  drivers.cleanup.push(server.close);
};
