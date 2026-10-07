import type { ZeropsFake } from "../zerops.ts";
import type { WireRequest, WireResponse } from "../../harness/http.ts";
import { projectRoles } from "../zeropsWorld.ts";

/** Creation writes share the platform's versioned inventory with browser and real Core reads. */
export class CreationFake {
  readonly accepted: { id: string; name: string }[] = [];
  outcome: "accepted" | "refused" | "lost" = "accepted";
  creationStatus: "FINISHED" | "FAILED" = "FINISHED";
  /** Somebody else creates a project of the same name as this one is accepted. */
  twin = false;
  readonly zerops: ZeropsFake;
  constructor(zerops: ZeropsFake) {
    this.zerops = zerops;
  }

  handle = async (request: WireRequest): Promise<WireResponse | undefined> => {
    const path = request.url.pathname.replace(/^\/api\/rest\/public/u, "");
    const create = path.match(/^\/client\/([^/]+)\/project$/u);
    if (create && request.method === "POST") {
      const orgId = create[1]!;
      const credential = request.headers.authorization?.replace(/^Bearer /u, "") ?? "";
      const person = this.zerops.people.get(credential);
      const member = this.zerops.world.members.get(orgId)?.find((row) => row.userId === person);
      if (!member || !member.canCreateProjects || this.outcome === "refused")
        return this.zerops.error(403, "insufficientPermissions", "Creation refused by Zerops.");
      const id = `created-${this.accepted.length + 1}`;
      const name = String(request.body.name);
      this.accepted.push({ id, name });
      this.zerops.put(
        "project",
        {
          id,
          name,
          clientId: orgId,
          status: "ACTIVE",
          tagList: request.body.tagList ?? [],
          userRoles: projectRoles(this.zerops.world, id, orgId),
          envList: [
            { id: `${id}-isolation`, key: "envIsolation", content: "service", sensitive: false },
          ],
        },
        "entity-first",
      );
      this.zerops.put(
        "process",
        {
          id: `${id}-creation`,
          projectId: id,
          clientId: orgId,
          actionName: "project.create",
          status: this.creationStatus,
          created: new Date().toISOString(),
          error:
            this.creationStatus === "FAILED"
              ? { code: "creationFailed", message: "Project capacity exhausted." }
              : null,
        },
        "entity-first",
      );
      if (this.twin)
        this.zerops.put(
          "project",
          {
            id: `twin-of-${id}`,
            name,
            clientId: orgId,
            status: "ACTIVE",
            tagList: [],
            userRoles: projectRoles(this.zerops.world, `twin-of-${id}`, orgId),
          },
          "entity-first",
        );
      return { body: this.zerops.rows("project").find((row) => row.id === id) };
    }
    const container = path.match(
      /^\/project\/([^/]+)\/first-class-recipe\/development-container$/u,
    );
    if (container && request.method === "PUT") {
      const projectId = container[1]!;
      const project = this.zerops.rows("project").find((row) => row.id === projectId);
      if (!project) return this.zerops.error(400, "projectNotFound");
      const credential = request.headers.authorization?.replace(/^Bearer /u, "") ?? "";
      if (!this.zerops.canWrite(credential, projectId))
        return this.zerops.error(403, "insufficientPermissions");
      const id = `container-${projectId}`;
      this.zerops.put(
        "service-stack",
        {
          id,
          projectId,
          clientId: project.clientId,
          name: "zcp",
          status: "ACTIVE",
          subdomainAccess: true,
          isSystem: false,
          serviceStackTypeInfo: {
            serviceStackTypeName: "zcp",
            serviceStackTypeVersionName: "zcp@1",
            serviceStackTypeCategory: "USER",
          },
          ports: [{ port: 8080, scheme: "http" }],
          userData: [{ key: "ZCP_MATE_ENABLED", content: "1" }],
        },
        "entity-first",
      );
      this.zerops.put(
        "user-data",
        {
          id: `${id}-mate`,
          serviceStackId: id,
          clientId: project.clientId,
          key: "ZCP_MATE_ENABLED",
          content: "1",
        },
        "entity-first",
      );
      const processId = this.zerops.writes.start(projectId, "service-stack.create", [id]);
      this.zerops.writes.transition(processId, "FINISHED");
      return { body: { processes: [{ id: processId }] } };
    }
    if (/^\/project\/[^/]+\/service-stack\/import$/u.test(path) && request.method === "POST") {
      const credential = request.headers.authorization?.replace(/^Bearer /u, "") ?? "";
      const response = await this.zerops.writes.handle(request, path, credential);
      if (response && response.status === undefined) {
        // Agent-off creation observes service readiness rather than reading each process.
        // Complete this area fixture's imports just as its container creation completes above.
        const imported = response.body as {
          serviceStacks: { processes: { id: string }[] }[];
        };
        for (const service of imported.serviceStacks)
          for (const process of service.processes)
            this.zerops.writes.transition(process.id, "FINISHED");
      }
      return response;
    }
    return undefined;
  };
}
