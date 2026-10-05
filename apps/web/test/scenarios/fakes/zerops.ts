import * as NodeEvents from "node:events";
import type { WebSocket } from "ws";
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
  output: string;
  search: SearchTerm[];
  members: Set<string>;
}
export type Fault = {
  status?: 401 | 403 | 404 | 429 | 500 | 502 | 503;
  retryAfter?: number;
  latency?: number;
  timeout?: boolean;
  silence?: boolean;
};

/** Fake time advances only when its driver says so; pending HTTP work is released by advance. */
export class FakeClock {
  now = 0;
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

/** Shared with runningCore's injected Zerops API, not a second copy of the organization. */
export class ZeropsFake {
  readonly clock = new FakeClock();
  readonly requests = new Map<string, number>();
  readonly requestsByKind = new Map<string, number>();
  readonly registrations = new Map<string, number>();
  readonly faults = new Map<string, Fault>();
  readonly handlers: HttpHandler[] = [];
  readonly entities = new Map<string, Map<string, EntityRow>>();
  readonly sockets = new Map<string, WebSocket>();
  readonly events = new NodeEvents.EventEmitter();
  readonly subscriptions = new Map<string, Registration>();
  readonly framesByKind = new Map<string, number>();
  private token = 0;
  private versions = new Map<string, number>();
  orgName = "KRLS";
  readonly world: FakeWorld;
  constructor(world: FakeWorld) {
    this.world = world;
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
    return [...(this.entities.get(kind)?.values() ?? [])];
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
    const full = this.rows(kind).find((p) => p.id === row.id)!;
    const send = (output: string) => {
      for (const registration of this.subscriptions.values()) {
        if (registration.kind !== kind || registration.output !== output) continue;
        const matches = this.matches(full, registration.search);
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
    const key = `${registration.kind}:${registration.output}`;
    this.framesByKind.set(key, (this.framesByKind.get(key) ?? 0) + 1);
    this.sockets
      .get(registration.receiver)
      ?.send(JSON.stringify({ type: "search", subscriptionName: registration.name, data }));
  }

  socket = (socket: WebSocket, url: URL) => {
    const parts = url.pathname.split("/");
    const receiver = parts.at(-2)!;
    const token = parts.at(-1)!;
    if (!this.world.tokens.has(token)) {
      socket.close(1008);
      return;
    }
    this.sockets.set(receiver, socket);
    socket.send(JSON.stringify({ type: "SocketSuccess", data: { Success: true } }));
    socket.on("message", (raw) => {
      const frame = JSON.parse(String(raw)) as { type?: string };
      if (frame.type === "ping") socket.send(JSON.stringify({ type: "pong", data: null }));
    });
    socket.on("close", () => {
      this.sockets.delete(receiver);
      for (const [key, registration] of this.subscriptions)
        if (registration.receiver === receiver) this.subscriptions.delete(key);
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

  handle: HttpHandler = async (request) => {
    const path = request.url.pathname.replace(/^\/api\/rest\/public/u, "");
    const key = `${request.method} ${path}`;
    this.requests.set(key, (this.requests.get(key) ?? 0) + 1);
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
        body: { code: "scenarioFault" },
        headers: fault.status === 429 ? { "Retry-After": String(fault.retryAfter ?? 1) } : {},
      };
    if (request.method === "OPTIONS") return { body: {} };
    if (path === "/authorize-app") {
      const origin = new URL(request.url.searchParams.get("origin")!);
      if (!["localhost", "127.0.0.1"].includes(origin.hostname))
        throw new Error("Nonlocal hand-over destination");
      const callback = `${origin.origin}${request.url.searchParams.get("path") ?? ""}/zerops/authorized#${new URLSearchParams({ token: "personal", state: request.url.searchParams.get("state")! })}`;
      return { status: 302, headers: { location: callback }, body: {} };
    }
    if (path === "/web-socket/login")
      return this.world.tokens.has(String(request.body.token))
        ? { body: { webSocketToken: request.body.token } }
        : { status: 401 };
    const bearer = request.headers.authorization?.replace(/^Bearer /u, "");
    if (!bearer || !this.world.tokens.has(bearer))
      return { status: 401, body: { code: "notAuthorized" } };
    for (const handler of this.handlers) {
      const response = await handler(request);
      if (response) return response;
    }
    if (path === "/user/info")
      return {
        body: {
          id: "owner",
          email: "owner@example.test",
          fullName: "Scenario Owner",
          clientUserList: [
            {
              id: "C-owner",
              clientId: "ORG",
              status: "ACTIVE",
              roleCode: "OWNER",
              client: { id: "ORG", accountName: this.orgName },
            },
          ],
        },
      };
    if (path.endsWith("/integration-token") && request.method === "POST") {
      const token = `throwaway-${++this.token}`;
      this.world.tokens.set(token, {
        id: token,
        name: String(request.body.name),
        orgId: "ORG",
        roleCode: String(request.body.roleCode),
        canCreateProjects: false,
        canViewFinances: false,
        canEditFinances: false,
        projects: [],
        createdMs: Date.now(),
        createdByUser: "owner",
      });
      return { body: { id: token, token } };
    }
    if (/\/integration-token\//u.test(path) && request.method === "DELETE") {
      this.world.tokens.delete(path.split("/").at(-1)!);
      return { body: {} };
    }
    if (path === "/client/ORG/user/list")
      return {
        body: {
          clientUserList: (this.world.members.get("ORG") ?? []).map((m) => ({
            id: m.clientUserId,
            userId: m.kind === "token" ? undefined : m.userId,
            status: m.status,
            roleCode: m.roleCode,
            user: {
              id: m.kind === "token" ? undefined : m.userId,
              fullName: m.name,
              email:
                m.kind === "token" ? `token-${m.userId}@zerops.io` : `${m.userId}@example.test`,
            },
          })),
        },
      };
    if (path === "/client/ORG/integration-token/list")
      return { body: { integrationTokenList: [...this.world.tokens.values()] } };
    if (path === "/client/ORG/settings")
      return { body: { locationList: [], serviceStackList: [] } };
    if (path.endsWith("/search")) return this.search(path.split("/")[1]!, request);
    if (path === "/client/ORG/project")
      return { body: { list: this.rows("project"), total: this.rows("project").length } };
    const projectServices = path.match(/^\/project\/([^/]+)\/service-stack$/u);
    if (projectServices)
      return {
        body: {
          list: this.rows("service-stack").filter((row) => row.projectId === projectServices[1]),
        },
      };
    if (/^\/project\/[^/]+\/public-http-routing$/u.test(path)) return { body: { list: [] } };
    if (/^\/service-stack\/[^/]+\/env$/u.test(path))
      return { body: { items: [{ id: "enabled", key: "ZCP_MATE_ENABLED", content: "1" }] } };
    const single = path.match(/^\/(project|service-stack|app-version)\/([^/]+)$/u);
    if (single) {
      const row = this.rows(single[1]!).find((r) => r.id === single[2]);
      return row ? { body: row } : { status: 404 };
    }
    return undefined;
  };

  private search(kind: string, request: WireRequest): WireResponse {
    const search = (request.body.search ?? []) as SearchTerm[];
    const rows = this.rows(kind).filter((row) => this.matches(row, search));
    const output = String(request.body.wsOutputType ?? "");
    if (output) {
      const name = String(request.body.subscriptionName);
      const receiver = String(request.body.receiverId);
      const registration = {
        kind,
        name,
        receiver,
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
        : { items: rows, totalHits: rows.length },
    };
  }
}
