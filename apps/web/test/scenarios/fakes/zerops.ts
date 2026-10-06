import { roleAtLeast } from "@t3tools/shared/zeropsRoles";
import { scenarioWorld, type ScenarioWorld } from "./zeropsWorld.ts";
import { ZeropsWrites } from "./zeropsWrites.ts";
import * as NodeEvents from "node:events";
import { WebSocket } from "ws";
import type { FakeWorld } from "../../../../hq/test/harness/zeropsFake.ts";
import {
  deadline,
  type HttpHandler,
  type WireRequest,
  type WireResponse,
} from "../harness/http.ts";

export type EntityRow = Record<string, unknown> & { id: string; _version: number };
export interface SearchTerm {
  name: string;
  operator: string;
  value: unknown;
}
interface Registration {
  kind: string;
  name: string;
  receiver: string;
  socket: WebSocket | undefined;
  apiToken: string;
  output: string;
  search: SearchTerm[];
  members: Set<string>;
}
export type Fault = {
  code?: string;
  message?: string;
  status?: number;
  retryAfter?: number;
  latency?: number;
  timeout?: boolean;
  silence?: boolean;
};

/** Fake time advances only when its driver says so; pending HTTP work is released by advance. */
export class FakeClock {
  now = 0;
  private wall: { at: number; elapsed: number } | undefined;
  /** Live wall time until a driver/page clock pins it; latency/credential time stays independent. */
  currentTimeMillis() {
    return this.wall ? this.wall.at + this.now - this.wall.elapsed : Date.now() + this.now;
  }
  setTime(timestamp: number) {
    if (!Number.isFinite(timestamp)) throw new Error("Clock timestamp must be finite");
    this.wall = { at: timestamp, elapsed: this.now };
  }
  private pending: { at: number; resolve: () => void }[] = [];
  wait(ms: number) {
    return new Promise<void>((resolve) => this.pending.push({ at: this.now + ms, resolve }));
  }
  advance(ms: number) {
    this.now += ms;
    const due = this.pending.filter((task) => task.at <= this.now);
    this.pending = this.pending.filter((task) => task.at > this.now);
    for (const task of due) task.resolve();
  }
}

/** One platform world, served over HTTP to both the browser and real Core. */
export class ZeropsFake {
  readonly clock = new FakeClock();
  readonly requests = new Map<string, number>();
  readonly requestsByKind = new Map<string, number>();
  readonly requestsByCredential = new Map<string, Map<string, number>>();
  readonly registrations = new Map<string, number>();
  readonly faults = new Map<string, Fault>();
  readonly handlers: HttpHandler[] = [];
  readonly entities = new Map<string, Map<string, EntityRow>>();
  readonly sockets = new Map<string, WebSocket>();
  readonly events = new NodeEvents.EventEmitter();
  readonly subscriptions = new Map<string, Registration>();
  readonly framesByKind = new Map<string, number>();
  get people() {
    return this.world.people;
  }
  origin = "";
  readonly writes: ZeropsWrites;
  private token = 0;
  socketTokenTtl = 60_000;
  private socketSerial = 0;
  readonly socketTokens = new Map<string, { apiToken: string; expiresAt: number }>();
  private versions = new Map<string, number>();
  private initialFrames = new Map<string, { registration: Registration; frame: string }[]>();
  get orgName() {
    return this.world.organizations.get("ORG")?.name ?? "KRLS";
  }
  set orgName(name: string) {
    this.world.organizations.set("ORG", { ...this.world.organizations.get("ORG"), name });
  }
  readonly world: ScenarioWorld;
  constructor(world: FakeWorld & Partial<ScenarioWorld>) {
    this.world = scenarioWorld(world);
    this.writes = new ZeropsWrites(this);
  }

  matches(row: EntityRow, search: SearchTerm[]) {
    return search.every(({ name, operator, value }) => {
      const actual = name
        .split(".")
        .reduce<unknown>(
          (node, key) =>
            node && typeof node === "object" ? (node as Record<string, unknown>)[key] : undefined,
          row,
        );
      switch (operator) {
        case "eq":
          return actual === value;
        case "ne":
          return actual !== value;
        case "in":
          return Array.isArray(value) && value.includes(actual);
        case "notIn":
        case "nin":
          return Array.isArray(value) && !value.includes(actual);
        case "gt":
          return Number(actual) > Number(value);
        case "gte":
          return Number(actual) >= Number(value);
        case "lt":
          return Number(actual) < Number(value);
        case "lte":
          return Number(actual) <= Number(value);
        case "contains":
          return String(actual).includes(String(value));
        default:
          throw new Error(`Unsupported search operator: ${operator}; add it in the area's driver.`);
      }
    });
  }

  rows(kind: string): EntityRow[] {
    if (kind === "project")
      return this.world.projects.map((p) => ({
        ...this.entities.get(kind)?.get(p.id),
        ...p,
        clientId: p.orgId,
        tagList: p.tags,
        created: "2026-10-05T12:00:00.000Z",
        lastUpdate: "2026-10-05T12:00:00.000Z",
        zeropsSubdomainHost: p.id.toLowerCase(),
        _version: this.versions.get(`project:${p.id}`) ?? 1,
      }));
    return [...(this.entities.get(kind)?.values() ?? [])].map((row) =>
      kind === "service-stack"
        ? { isSystem: false, subdomainAccess: false, userData: [], activeAppVersion: null, ...row }
        : row,
    );
  }

  /** Full rows and list membership are independently sent, in the requested order. */
  put(
    kind: string,
    row: Record<string, unknown> & { id: string },
    order: "entity-first" | "membership-first" = "membership-first",
  ) {
    const key = `${kind}:${row.id}`;
    const version = (this.versions.get(key) ?? 1) + 1;
    this.versions.set(key, version);
    if (!this.entities.has(kind)) this.entities.set(kind, new Map());
    this.entities.get(kind)!.set(row.id, { ...row, _version: version });
    if (kind === "project") {
      const index = this.world.projects.findIndex((p) => p.id === row.id);
      const project = {
        id: row.id,
        orgId: String(row.clientId ?? "ORG"),
        name: String(row.name),
        status: String(row.status ?? "ACTIVE"),
        tags: (row.tagList ?? row.tags ?? []) as string[],
        userRoles: (row.userRoles ?? []) as FakeWorld["projects"][number]["userRoles"],
        publicZone: String(row.publicZone ?? `${row.id}.prg1-zerops.zone`),
      };
      if (index < 0) this.world.projects.push(project);
      else this.world.projects[index] = project;
    }
    if (kind === "service-stack") {
      const service = {
        id: row.id,
        projectId: String(row.projectId),
        name: String(row.name),
        status: String(row.status ?? "ACTIVE"),
        isSystem: Boolean(row.isSystem),
        subdomainAccess: Boolean(row.subdomainAccess),
        http:
          (row.ports as { scheme?: string }[] | undefined)?.some((port) =>
            ["http", "https"].includes(port.scheme ?? ""),
          ) ?? false,
        named: (() => {
          const values = row.userData as { key: string; content: string }[] | undefined;
          const id = values?.find((item) => item.key === "appVersionId")?.content;
          return id
            ? { id, name: values?.find((item) => item.key === "appVersionName")?.content ?? "" }
            : null;
        })(),
        activeVersionId: (row.activeAppVersion as { id: string } | undefined)?.id ?? null,
      };
      const index = this.world.services.findIndex((item) => item.id === row.id);
      if (index < 0) this.world.services.push(service);
      else this.world.services[index] = { ...this.world.services[index]!, ...service };
    }
    const full = this.rows(kind).find((p) => p.id === row.id)!;
    const send = (output: string) => {
      for (const registration of this.subscriptions.values()) {
        if (registration.kind !== kind || registration.output !== output) continue;
        const matches =
          this.canReadRow(registration.apiToken, kind, full) &&
          this.matches(full, registration.search);
        if (output === "updateStream") {
          if (matches) this.push(registration, { update: [full] });
        } else {
          const was = registration.members.has(row.id);
          if (matches) registration.members.add(row.id);
          else registration.members.delete(row.id);
          if (was !== matches)
            this.push(registration, {
              add: matches ? [row.id] : [],
              delete: matches ? [] : [row.id],
            });
        }
      }
    };
    for (const output of order === "entity-first"
      ? ["updateStream", "listStream"]
      : ["listStream", "updateStream"])
      send(output);
  }

  remove(kind: string, id: string) {
    if (kind === "project") {
      const index = this.world.projects.findIndex((row) => row.id === id);
      if (index >= 0) this.world.projects.splice(index, 1);
    }
    this.entities.get(kind)?.delete(id);
    for (const registration of this.subscriptions.values()) {
      if (
        registration.kind === kind &&
        registration.output === "listStream" &&
        registration.members.delete(id)
      )
        this.push(registration, { add: [], delete: [id] });
    }
  }

  private push(registration: Registration, data: unknown) {
    if (this.faults.get(`${registration.kind}:push`)?.silence) return;
    const frame = JSON.stringify({ type: "search", subscriptionName: registration.name, data });
    const socket = this.sockets.get(registration.receiver);
    if (socket?.readyState === WebSocket.OPEN) this.deliver(registration, socket, frame);
    else if (registration.socket === undefined) {
      const pending = this.initialFrames.get(registration.receiver) ?? [];
      pending.push({ registration, frame });
      this.initialFrames.set(registration.receiver, pending);
    }
  }

  private deliver(registration: Registration, socket: WebSocket, frame: string) {
    const key = `${registration.kind}:${registration.output}`;
    this.framesByKind.set(key, (this.framesByKind.get(key) ?? 0) + 1);
    socket.send(frame);
  }

  socket = (socket: WebSocket, url: URL) => {
    const parts = url.pathname.split("/");
    const receiver = parts.at(-2)!;
    const token = parts.at(-1)!;
    const login = this.socketTokens.get(token);
    if (!login || login.expiresAt <= this.clock.now || !this.world.tokens.has(login.apiToken)) {
      socket.close(1008);
      return;
    }
    this.sockets.set(receiver, socket);
    socket.send(JSON.stringify({ type: "SocketSuccess", data: { Success: true } }));
    // Only the initial bind drains pending frames. Closed sockets lose their owned registrations,
    // so reconnects still require fresh current-state reads rather than replaying an outage.
    for (const registration of this.subscriptions.values()) {
      if (registration.receiver !== receiver || registration.socket !== undefined) continue;
      registration.socket = socket;
    }
    for (const { registration, frame } of this.initialFrames.get(receiver) ?? []) {
      if (this.subscriptions.get(`${receiver}:${registration.name}`) === registration)
        this.deliver(registration, socket, frame);
    }
    this.initialFrames.delete(receiver);
    socket.on("message", (raw) => {
      const frame = JSON.parse(String(raw)) as { type?: string };
      if (frame.type === "ping") socket.send(JSON.stringify({ type: "pong", data: null }));
    });
    socket.on("close", () => {
      if (this.sockets.get(receiver) === socket) this.sockets.delete(receiver);
      for (const [key, registration] of this.subscriptions)
        if (registration.socket === socket) this.subscriptions.delete(key);
      this.events.emit("change");
    });
    this.events.emit("change");
  };

  waitForRegistration(kind: string, output = "listStream") {
    if ([...this.subscriptions.values()].some((r) => r.kind === kind && r.output === output))
      return Promise.resolve();
    return deadline(
      new Promise<void>((resolve) => {
        const check = () => {
          if (
            [...this.subscriptions.values()].some((r) => r.kind === kind && r.output === output)
          ) {
            this.events.off("change", check);
            resolve();
          }
        };
        this.events.on("change", check);
      }),
      `${kind} ${output} registration`,
    );
  }

  async waitForRequest(key: string, count = 1) {
    if ((this.requests.get(key) ?? 0) >= count) return;
    let listener = () => {};
    try {
      await deadline(
        new Promise<void>((resolve) => {
          listener = () => {
            if ((this.requests.get(key) ?? 0) >= count) resolve();
          };
          this.events.on("request", listener);
        }),
        `${key} request receipt`,
      );
    } finally {
      this.events.off("request", listener);
    }
  }

  private memberships(credential: string) {
    const person = this.people.get(credential);
    return person === undefined
      ? []
      : [...this.world.members].flatMap(([orgId, members]) =>
          members
            .filter((member) => member.kind === "person" && member.userId === person)
            .map((member) => ({ orgId, member })),
        );
  }

  canAccessOrg(credential: string, orgId: string) {
    const token = this.world.tokens.get(credential);
    if (!token) return false;
    const memberships = this.memberships(credential);
    return memberships.length
      ? memberships.some(({ orgId: id, member }) => id === orgId && member.status === "ACTIVE")
      : token.orgId === orgId;
  }

  role(credential: string, orgId = this.world.tokens.get(credential)?.orgId ?? "") {
    if (!this.canAccessOrg(credential, orgId)) return "NO_ACCESS";
    return (
      this.memberships(credential).find((m) => m.orgId === orgId)?.member.roleCode ??
      this.world.tokens.get(credential)?.roleCode
    );
  }

  private projectRole(credential: string, projectId: string, orgId?: string) {
    const token = this.world.tokens.get(credential);
    if (!token) return "NO_ACCESS";
    const project = this.world.projects.find((row) => row.id === projectId);
    const organization = project?.orgId ?? orgId ?? token.orgId;
    if (!this.canAccessOrg(credential, organization)) return "NO_ACCESS";
    const member = this.memberships(credential).find((m) => m.orgId === organization)?.member;
    const grant = this.people.has(credential)
      ? project?.userRoles.find((grant) => grant.clientUserId === member?.clientUserId)?.roleCode
      : token.projects.find((grant) => grant.projectId === projectId)?.roleCode;
    return grant ?? this.role(credential, organization);
  }

  canRead(credential: string, projectId: string, orgId?: string) {
    return roleAtLeast(this.projectRole(credential, projectId, orgId), "READ_ONLY");
  }

  canWrite(credential: string, projectId: string) {
    return (
      this.world.projects.some((row) => row.id === projectId) &&
      roleAtLeast(this.projectRole(credential, projectId), "BASIC_USER")
    );
  }

  private canReadRow(credential: string, kind: string, row: EntityRow) {
    const projectId =
      kind === "project"
        ? row.id
        : (row.projectId ??
          this.world.services.find((service) => service.id === row.serviceStackId)?.projectId ??
          "");
    return this.canRead(
      credential,
      String(projectId),
      typeof row.clientId === "string" ? row.clientId : undefined,
    );
  }

  error(status: number, code: string, message = code): WireResponse {
    return {
      status,
      body: { error: { code, message, meta: [{ error: message, code, metadata: null }] } },
    };
  }

  handle: HttpHandler = async (request) => {
    const path = request.url.pathname.replace(/^\/api\/rest\/public/u, "");
    const key = `${request.method} ${path}`;
    this.requests.set(key, (this.requests.get(key) ?? 0) + 1);
    const credential = request.headers.authorization?.replace(/^Bearer /u, "") ?? "anonymous";
    if (!this.requestsByCredential.has(credential))
      this.requestsByCredential.set(credential, new Map());
    const spent = this.requestsByCredential.get(credential)!;
    spent.set(key, (spent.get(key) ?? 0) + 1);
    this.events.emit("request");
    if (request.method !== "OPTIONS") {
      const kind = path.split("/")[1] ?? "unknown";
      this.requestsByKind.set(kind, (this.requestsByKind.get(kind) ?? 0) + 1);
    }
    const fault = this.faults.get(key);
    if (fault?.latency) await this.clock.wait(fault.latency);
    if (fault?.timeout || fault?.silence) await new Promise<void>(() => {});
    if (fault?.status)
      return {
        status: fault.status,
        ...this.error(
          fault.status,
          fault.code ??
            (
              {
                400: "projectNotFound",
                401: "notAuthorized",
                403: "insufficientPermissions",
                404: "notFound",
                429: "tooManyRequests",
                500: "internalServerError",
                502: "badGateway",
                503: "serviceUnavailable",
              } as Record<number, string>
            )[fault.status] ??
            (fault.status >= 500 ? "internalServerError" : "scenarioFault"),
          fault.message,
        ),
        headers: fault.status === 429 ? { "Retry-After": String(fault.retryAfter ?? 1) } : {},
      };
    if (request.method === "OPTIONS") return { body: {} };
    if (path.startsWith("/scenario-logs/")) return { body: { items: [] } };
    if (path === "/authorize-app") {
      const origin = new URL(request.url.searchParams.get("origin")!);
      if (!["localhost", "127.0.0.1"].includes(origin.hostname))
        throw new Error("Nonlocal hand-over destination");
      const callback = `${origin.origin}${request.url.searchParams.get("path") ?? ""}/zerops/authorized#${new URLSearchParams({ token: String(request.headers["x-scenario-person"] ?? "personal"), state: request.url.searchParams.get("state")! })}`;
      return { status: 302, headers: { location: callback }, body: {} };
    }
    if (path === "/web-socket/login") {
      const apiToken = String(request.body.token);
      if (!this.world.tokens.has(apiToken))
        return this.error(401, "notAuthorized", "Not authorized");
      const webSocketToken = `socket-${++this.socketSerial}`;
      this.socketTokens.set(webSocketToken, {
        apiToken,
        expiresAt: this.clock.now + this.socketTokenTtl,
      });
      return { body: { webSocketToken } };
    }
    const bearer = request.headers.authorization?.replace(/^Bearer /u, "");
    if (!bearer || !this.world.tokens.has(bearer))
      return this.error(401, "notAuthorized", "Not authorized");
    for (const handler of this.handlers) {
      const response = await handler(request);
      if (response) return response;
    }
    const clientScope = path.match(/^\/client\/([^/]+)(?:\/|$)/u)?.[1];
    if (clientScope && !this.canAccessOrg(bearer, clientScope))
      return this.error(403, "insufficientPermissions", "Insufficient permissions");
    const scope = path.match(/^\/project\/([^/]+)/u);
    if (
      scope &&
      this.world.projects.some((project) => project.id === scope[1]) &&
      !this.canRead(bearer, scope[1]!)
    )
      return this.error(403, "insufficientPermissions", "Insufficient permissions");
    const written = await this.writes.handle(request, path, bearer);
    if (written) return written;
    if (path === "/user/info") {
      const credential = this.world.tokens.get(bearer)!;
      const person = this.people.get(bearer);
      const memberships = this.memberships(bearer);
      const clientUserList = memberships.length
        ? memberships.map(({ orgId, member }) => ({
            id: member.clientUserId,
            clientId: orgId,
            status: member.status,
            roleCode: member.roleCode,
            canCreateProjects: member.canCreateProjects,
            client: { id: orgId, accountName: this.world.organizations.get(orgId)?.name ?? orgId },
          }))
        : [
            {
              id: `C-${credential.id}`,
              clientId: credential.orgId,
              status: "ACTIVE",
              roleCode: credential.roleCode,
              canCreateProjects: credential.canCreateProjects,
              client: {
                id: credential.orgId,
                accountName:
                  this.world.organizations.get(credential.orgId)?.name ?? credential.orgId,
              },
            },
          ];
      return {
        body: {
          id: person ?? credential.id,
          email: `${person ?? credential.id}@example.test`,
          fullName: person ?? credential.name,
          clientUserList,
        },
      };
    }
    if (
      clientScope &&
      path === `/client/${clientScope}/integration-token` &&
      request.method === "POST"
    ) {
      const token = `throwaway-${++this.token}`;
      this.world.tokens.set(token, {
        id: token,
        name: String(request.body.name),
        orgId: clientScope,
        roleCode: String(request.body.roleCode),
        canCreateProjects: Boolean(request.body.canCreateProjects),
        canViewFinances: Boolean(request.body.canViewFinances),
        canEditFinances: Boolean(request.body.canEditFinances),
        projects: (request.body.projects ?? []) as { projectId: string; roleCode: string }[],
        createdMs: Date.now(),
        createdByUser: this.people.get(bearer) ?? "owner",
      });
      return { body: { id: token, token } };
    }
    if (/\/integration-token\//u.test(path) && request.method === "DELETE") {
      const id = path.split("/").at(-1)!;
      for (const [value, token] of this.world.tokens)
        if (token.orgId === clientScope && token.id === id) this.world.tokens.delete(value);
      return { body: {} };
    }
    if (clientScope && path === `/client/${clientScope}/user/list`)
      return {
        body: {
          clientUserList: (this.world.members.get(clientScope) ?? []).map((m) => ({
            id: m.clientUserId,
            userId: m.userId,
            canCreateProjects: m.canCreateProjects,
            status: m.status,
            roleCode: m.roleCode,
            user: {
              id: m.userId,
              fullName: m.name,
              email:
                m.kind === "token" ? `token-${m.userId}@zerops.io` : `${m.userId}@example.test`,
            },
          })),
        },
      };
    const tokenRead = path.match(/^\/client\/([^/]+)\/integration-token\/([^/]+)$/u);
    if (tokenRead && tokenRead[2] !== "list" && request.method === "GET") {
      const token = [...this.world.tokens.values()].find(
        (token) => token.orgId === tokenRead[1] && token.id === tokenRead[2],
      );
      return token
        ? { body: { ...token, created: new Date(token.createdMs).toISOString() } }
        : this.error(400, "integrationTokenNotFound");
    }
    if (clientScope && path === `/client/${clientScope}/integration-token/list`)
      return {
        body: {
          integrationTokenList: [...this.world.tokens.values()].filter(
            (token) => token.orgId === clientScope,
          ),
        },
      };
    if (clientScope && path === `/client/${clientScope}/settings`)
      return {
        body: {
          locationList: [],
          serviceStackList: [],
          ...this.world.organizations.get(clientScope)?.settings,
        },
      };
    const envFile = path.match(/^\/project\/([^/]+)\/env-file$/u);
    if (envFile)
      return {
        body: {
          envFile: (this.world.env.get(envFile[1]!) ?? [])
            .map(
              (env) =>
                `${env.key}="${(env.sensitive && !roleAtLeast(this.projectRole(bearer, envFile[1]!), "BASIC_USER") ? "REDACTED" : env.value).replace(/[\\"$]/gu, "\\$&")}"`,
            )
            .join("\n"),
        },
      };
    const logs = path.match(/^\/project\/([^/]+)\/log$/u);
    if (logs) return { body: { url: `${this.origin}/scenario-logs/${logs[1]}` } };
    if (path.startsWith("/scenario-logs/")) return { body: { items: [] } };
    if (path.endsWith("/search")) return this.search(path.split("/")[1]!, request, bearer);
    if (clientScope && path === `/client/${clientScope}/project`) {
      const rows = this.rows("project").filter(
        (row) => row.clientId === clientScope && this.canReadRow(bearer, "project", row),
      );
      return { body: { list: rows, total: rows.length } };
    }
    const projectServices = path.match(/^\/project\/([^/]+)\/service-stack$/u);
    if (projectServices)
      return {
        body: {
          list: this.rows("service-stack").filter((row) => row.projectId === projectServices[1]),
        },
      };
    if (/^\/project\/[^/]+\/public-http-routing$/u.test(path)) return { body: { list: [] } };
    // A project's newest processes, newest first, as the platform lists them (`?limit=100`).
    const projectProcesses = path.match(/^\/project\/([^/]+)\/process$/u);
    if (projectProcesses) {
      const list = this.rows("process")
        .filter((row) => row.projectId === projectProcesses[1])
        .toSorted((left, right) => String(right.created).localeCompare(String(left.created)))
        .slice(0, 100);
      return { body: { list, count: list.length, limit: 100, offset: 0, total: list.length } };
    }
    if (/^\/service-stack\/[^/]+\/env$/u.test(path))
      return { body: { items: [{ id: "enabled", key: "ZCP_MATE_ENABLED", content: "1" }] } };
    const single = path.match(/^\/(project|service-stack|app-version)\/([^/]+)$/u);
    if (single) {
      const row = this.rows(single[1]!).find((r) => r.id === single[2]);
      if (row && !this.canReadRow(bearer, single[1]!, row))
        return this.error(403, "insufficientPermissions", "Insufficient permissions");
      return row
        ? { body: row }
        : this.error(
            400,
            `${single[1] === "service-stack" ? "serviceStack" : single[1] === "app-version" ? "appVersion" : single[1]}NotFound`,
            single[1] === "project" ? "Project not found." : undefined,
          );
    }
    return undefined;
  };

  private search(kind: string, request: WireRequest, apiToken: string): WireResponse {
    const search = (request.body.search ?? []) as SearchTerm[];
    const rows = this.rows(kind).filter(
      (row) => this.canReadRow(apiToken, kind, row) && this.matches(row, search),
    );
    const limit = Number(request.body.limit ?? 1000);
    const offset = Number(request.body.offset ?? 0);
    const output = String(request.body.wsOutputType ?? "");
    if (output) {
      const name = String(request.body.subscriptionName);
      const receiver = String(request.body.receiverId);
      const registration = {
        kind,
        name,
        receiver,
        socket: this.sockets.get(receiver),
        apiToken,
        output,
        search,
        members: new Set(rows.map((row) => row.id)),
      };
      this.subscriptions.set(`${receiver}:${name}`, registration);
      const key = `${kind}:${output}`;
      this.registrations.set(key, (this.registrations.get(key) ?? 0) + 1);
      this.events.emit("change");
    }
    return {
      body: request.body.disableOutput
        ? { success: true }
        : { items: rows.slice(offset, offset + limit), totalHits: rows.length, limit, offset },
    };
  }
}
