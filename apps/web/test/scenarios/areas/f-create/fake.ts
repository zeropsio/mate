import type { ScenarioExtension, ScenarioDrivers } from "../../harness/scenario.ts";
import { CreationFake } from "../../fakes/f-create/creation.ts";
import { MateFake } from "../../fakes/mate.ts";
import { replyLossProxy } from "../../fakes/f-create/replyLoss.ts";
import { serve } from "../../harness/http.ts";
import type { SearchTerm } from "../../fakes/zerops.ts";

type CreationControl = CreationFake & {
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
    holdCreation: false,
    deleted: [] as string[],
    mateKeys: [] as string[],
  });
  controls.set(drivers, creation);
  drivers.zerops.handlers.push(async (request) => {
    const path = request.url.pathname.replace(/^\/api\/rest\/public/u, "");
    if (
      path === "/client-user/search" &&
      request.method === "POST" &&
      request.body.wsOutputType === "updateStream"
    ) {
      // The shared member-list fake answers searches but does not register membership pushes.
      const zerops = drivers.zerops;
      const name = String(request.body.subscriptionName);
      const receiver = String(request.body.receiverId);
      zerops.subscriptions.set(`${receiver}:${name}`, {
        kind: "client-user",
        name,
        receiver,
        socket: zerops.sockets.get(receiver),
        apiToken: request.headers.authorization?.replace(/^Bearer /u, "") ?? "",
        output: "updateStream",
        search: (request.body.search ?? []) as SearchTerm[],
        members: new Set(),
      });
      const key = "client-user:updateStream";
      zerops.registrations.set(key, (zerops.registrations.get(key) ?? 0) + 1);
      zerops.events.emit("change");
      return { body: { success: true } };
    }
    if (
      path === "/client/ORG/integration-token" &&
      request.method === "POST" &&
      typeof request.body.name === "string" &&
      request.body.name.startsWith("zcp-")
    )
      creation.mateKeys.push(request.body.name);
    if (path === "/client/ORG/project" && request.method === "POST") {
      // The base fake creates a FINISHED process. Do not publish that transient state when a
      // scenario holds creation: the first process frame must be RUNNING, not a raced completion.
      const previousPush = drivers.zerops.faults.get("process:push");
      if (creation.holdCreation) drivers.zerops.faults.set("process:push", { silence: true });
      let response;
      try {
        response = await creation.handle(request);
      } finally {
        if (creation.holdCreation) {
          if (previousPush === undefined) drivers.zerops.faults.delete("process:push");
          else drivers.zerops.faults.set("process:push", previousPush);
        }
      }
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
