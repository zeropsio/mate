import { parse } from "yaml";
import type { ZeropsFake, EntityRow } from "./zerops.ts";
import type { WireRequest, WireResponse } from "../harness/http.ts";

export type ProcessStatus = "PENDING" | "RUNNING" | "FINISHED" | "FAILED" | "CANCELLED";
interface Job {
  services: string[];
  version?: string;
  action: string;
}

/** All platform writes, including Core's HTTP deploys, enter the same versioned realtime table. */
export class ZeropsWrites {
  private serial = 0;
  readonly jobs = new Map<string, Job>();
  autoComplete = true;
  readonly platform: ZeropsFake;
  constructor(platform: ZeropsFake) {
    this.platform = platform;
  }
  private id(kind: string) {
    return `${kind}-${++this.serial}`;
  }
  private at() {
    return new Date(this.platform.clock.currentTimeMillis()).toISOString();
  }
  private row(kind: string, id: string) {
    return this.platform.rows(kind).find((row) => row.id === id);
  }
  private service(id: string) {
    return this.row("service-stack", id);
  }
  private putService(row: EntityRow, patch: Record<string, unknown>) {
    this.platform.put("service-stack", { ...row, ...patch });
  }

  start(projectId: string, action: string, services: string[], version?: string) {
    const id = this.id("process");
    this.jobs.set(id, { action, services, ...(version === undefined ? {} : { version }) });
    this.platform.put("process", {
      id,
      clientId: this.row("project", projectId)?.clientId,
      projectId,
      actionName: action,
      status: "PENDING",
      created: this.at(),
      started: null,
      finished: null,
      lastUpdate: this.at(),
      executorTag: "USER",
      serviceStackId: services[0] ?? null,
      serviceStacks: services.map((id) => ({ id })),
      error: null,
      appVersion: version ? { id: version } : null,
    });
    this.transition(id, "RUNNING");
    return id;
  }

  /**
   * Activates a version the service already built (`PUT /app-version/{id}/deploy`, a roll back):
   * no build, the version `DEPLOYING` until its deploy ends (`m0/vers-probe`). The process's id.
   */
  activate(versionId: string) {
    const version = this.platform.world.appVersions.get(versionId)!;
    const row = this.row("app-version", versionId)!;
    this.platform.put("app-version", { ...row, status: "DEPLOYING" });
    return this.start(String(row.projectId), "stack.deploy", [version.serviceId], versionId);
  }

  transition(id: string, status: ProcessStatus, message?: string) {
    const row = this.row("process", id);
    if (!row) throw new Error(`Unknown process ${id}`);
    const job = this.jobs.get(id);
    const terminal = ["FINISHED", "FAILED", "CANCELLED"].includes(status);
    const wireStatus = status === "CANCELLED" ? "CANCELED" : status;
    this.platform.put("process", {
      ...row,
      status: wireStatus,
      lastUpdate: this.at(),
      started: row.started ?? (status === "RUNNING" ? this.at() : null),
      finished: terminal ? this.at() : null,
      error: message ? { code: status === "FAILED" ? "buildFailed" : "canceled", message } : null,
    });
    if (!job || !terminal) return;
    if (job.version) {
      const version = this.platform.world.appVersions.get(job.version)!;
      version.status = status === "FINISHED" ? "ACTIVE" : "BUILD_FAILED";
      for (const other of this.platform.world.appVersions.values()) {
        if (
          other.id !== version.id &&
          other.serviceId === version.serviceId &&
          other.status === "ACTIVE"
        ) {
          other.status = "BACKUP";
          this.platform.put("app-version", {
            ...this.row("app-version", other.id)!,
            status: "BACKUP",
          });
        }
      }
      this.platform.put("app-version", {
        ...this.row("app-version", version.id)!,
        status: version.status,
      });
    }
    for (const serviceId of job.services) {
      const service = this.service(serviceId);
      if (service)
        this.putService(service, {
          status: status === "FINISHED" ? "ACTIVE" : "ACTION_FAILED",
          ...(job.version && status === "FINISHED"
            ? { activeAppVersion: { id: job.version } }
            : {}),
        });
    }
  }

  private advance(id: string) {
    if (!this.autoComplete || this.row("process", id)?.status !== "RUNNING") return;
    const job = this.jobs.get(id)!;
    const version = job.version ? this.platform.world.appVersions.get(job.version) : undefined;
    const outcome = version
      ? this.platform.world.outcome(version)
      : this.platform.world.importOutcome();
    if (["BUILDING", "RUNNING"].includes(outcome)) return;
    this.transition(
      id,
      ["BUILD_FAILED", "FAILED"].includes(outcome) ? "FAILED" : "FINISHED",
      ["BUILD_FAILED", "FAILED"].includes(outcome) ? "Platform job failed" : undefined,
    );
  }

  private allowed(credential: string, projectId: string) {
    return this.platform.canWrite(credential, projectId);
  }

  async handle(
    request: WireRequest,
    path: string,
    credential: string,
  ): Promise<WireResponse | undefined> {
    const process = path.match(/^\/process\/([^/]+)$/u);
    if (process && request.method === "GET") {
      this.advance(process[1]!);
      const row = this.row("process", process[1]!);
      return row ? { body: row } : this.platform.error(400, "processNotFound");
    }
    const versionRead = path.match(/^\/app-version\/([^/]+)$/u);
    if (versionRead && request.method === "GET") {
      for (const [id, job] of this.jobs) if (job.version === versionRead[1]) this.advance(id);
      const row = this.row("app-version", versionRead[1]!);
      return row ? { body: row } : this.platform.error(400, "appVersionNotFound");
    }
    const importMatch = path.match(/^\/project\/([^/]+)\/service-stack\/import$/u);
    const createVersion = path.match(/^\/service-stack\/([^/]+)\/app-version$/u);
    const subdomain = path.match(/^\/service-stack\/([^/]+)\/enable-subdomain-access$/u);
    const versionWrite = path.match(/^\/app-version\/([^/]+)\/(upload|build-and-deploy|deploy)$/u);
    if (!importMatch && !createVersion && !subdomain && !versionWrite) return undefined;
    const service =
      createVersion || subdomain
        ? this.service((createVersion ?? subdomain)![1]!)
        : versionWrite
          ? this.service(this.platform.world.appVersions.get(versionWrite[1]!)?.serviceId ?? "")
          : undefined;
    const projectId = importMatch?.[1] ?? String(service?.projectId ?? "");
    if (!this.row("project", projectId))
      return this.platform.error(400, "projectNotFound", "Project not found.");
    if (!this.allowed(credential, projectId))
      return this.platform.error(403, "insufficientPermissions", "Insufficient permissions");
    if (createVersion && request.method === "POST") {
      const id = this.id("version");
      const name = String(request.body.name);
      this.platform.world.appVersions.set(id, {
        id,
        serviceId: service!.id,
        name,
        status: "UPLOADING",
        archive: undefined,
        zeropsYaml: undefined,
        setup: undefined,
      });
      this.platform.put("app-version", {
        id,
        name,
        projectId,
        clientId: this.row("project", projectId)!.clientId,
        serviceStackId: service!.id,
        status: "UPLOADING",
        // A version made through the API reads `CLI`; every push of it carries the whole row
        // (`m0/vers-probe`).
        source: "CLI",
        created: this.at(),
      });
      return { body: { id } };
    }
    if (versionWrite && request.method === "PUT") {
      const version = this.platform.world.appVersions.get(versionWrite[1]!)!;
      if (versionWrite[2] === "upload") {
        version.archive = request.rawBody ?? new Uint8Array();
        return { body: {} };
      }
      if (versionWrite[2] === "deploy") {
        if (request.body.zeropsYaml === undefined || request.body.zeropsYamlSetup === undefined)
          return this.platform.error(400, "zeropsYamlSetupNotFound");
        return { body: { id: this.activate(version.id) } };
      }
      if (!version.archive) return this.platform.error(400, "appVersionNotUploaded");
      version.zeropsYaml = String(request.body.zeropsYaml);
      version.setup = String(request.body.zeropsYamlSetup);
      version.status = "BUILDING";
      this.platform.put("app-version", {
        ...this.row("app-version", version.id)!,
        status: "BUILDING",
      });
      this.putService(service!, {
        userData: [
          { key: "appVersionId", content: version.id },
          { key: "appVersionName", content: version.name },
        ],
      });
      for (const [key, content] of [
        ["appVersionId", version.id],
        ["appVersionName", version.name],
      ])
        this.platform.put("user-data", {
          id: `${service!.id}-${key}`,
          serviceStackId: service!.id,
          projectId,
          clientId: this.row("project", projectId)!.clientId,
          key,
          content,
        });
      return {
        body: {
          id: this.start(projectId, "service-stack.build-and-deploy", [service!.id], version.id),
        },
      };
    }
    if (subdomain && request.method === "PUT") {
      this.putService(service!, { subdomainAccess: true });
      return {
        body: { id: this.start(projectId, "service-stack.enable-subdomain-access", [service!.id]) },
      };
    }
    if (importMatch && request.method === "POST") {
      const yaml = String(request.body.yaml);
      const parsed = parse(yaml) as {
        services?: {
          hostname: string;
          type?: string;
          ports?: unknown[];
          envSecrets?: Record<string, string>;
          envVariables?: Record<string, string>;
        }[];
      };
      this.platform.world.imports.push({ projectId, yaml });
      const serviceStacks = (parsed.services ?? []).map((spec) => {
        const id = this.id("service");
        this.platform.put("service-stack", {
          id,
          projectId,
          clientId: this.row("project", projectId)!.clientId,
          name: spec.hostname,
          status: "CREATING",
          isSystem: false,
          subdomainAccess: false,
          serviceStackTypeInfo: {
            serviceStackTypeName: spec.type?.split("@")[0] ?? "nodejs",
            serviceStackTypeVersionName: spec.type ?? "nodejs@22",
          },
          ports: spec.ports ?? [],
          userData: [],
        });
        for (const [key, content] of Object.entries({ ...spec.envVariables, ...spec.envSecrets }))
          this.platform.put("user-data", {
            id: `${id}-${key}`,
            projectId,
            clientId: this.row("project", projectId)!.clientId,
            serviceStackId: id,
            key,
            content,
          });
        return {
          name: spec.hostname,
          processes: [{ id: this.start(projectId, "service-stack.create", [id]) }],
        };
      });
      return { body: { serviceStacks } };
    }
    return undefined;
  }
}
