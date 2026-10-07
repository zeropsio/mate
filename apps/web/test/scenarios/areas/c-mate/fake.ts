import { WS_METHODS, ZeropsAgentAuthSnapshot } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import type { MateFake } from "../../fakes/mate.ts";
import { definePerson } from "../../fakes/zeropsWorld.ts";
import { deadline } from "../../harness/http.ts";
import type { ScenarioDrivers, ScenarioExtension } from "../../harness/scenario.ts";
import { V1ChatWire } from "./v1.ts";
import type { ChatWire } from "./wire.ts";

const decodeAuth = Schema.decodeUnknownSync(ZeropsAgentAuthSnapshot);
const encodeAuth = Schema.encodeSync(ZeropsAgentAuthSnapshot);

/** Provider-side facts and response receipts, all outside the client. */
export class ChatDriver {
  readonly http: string[] = [];
  ownership: "project-token" | "owner" | "colleague" | "unrecorded" = "project-token";
  signerOffboarded = false;
  readonly mate: MateFake;
  readonly wire: ChatWire;
  constructor(mate: MateFake, wire: ChatWire = new V1ChatWire(mate)) {
    this.mate = mate;
    this.wire = wire;
    const original = mate.handle;
    mate.handle = (request) => {
      this.http.push(`${request.method} ${request.url.pathname}`);
      return original(request);
    };
    mate.rpcHandlers.push((request, socket) => {
      if (request.tag !== WS_METHODS.subscribeZeropsAgentAuth) return false;
      mate.subscriptions.get(socket)!.set(request.id, request);
      mate.chunk(socket, request.id, [encodeAuth(this.auth())]);
      return true;
    });
  }

  sentTurnCount() {
    return this.wire.intents().filter((intent) => intent.kind === "turn").length;
  }

  doorCount() {
    return this.http.filter((path) => path === "POST /mate/api/auth/zerops-throwaway").length;
  }

  commandDecisions() {
    return this.wire
      .intents()
      .flatMap((intent) =>
        intent.kind !== "decision"
          ? []
          : [
              intent.decision === "accept"
                ? "approved"
                : intent.decision === "decline"
                  ? "declined"
                  : intent.decision,
            ],
      );
  }

  receivedStagingAnswer() {
    return this.wire
      .intents()
      .some(
        (intent) =>
          intent.kind === "answer" &&
          intent.ask === "question" &&
          intent.answers.target === "stage",
      );
  }

  responseCount() {
    return this.wire.intents().filter((intent) => intent.kind !== "turn").length;
  }

  offboardSigner() {
    this.signerOffboarded = true;
    for (const [socket, subscriptions] of this.mate.subscriptions)
      for (const [id, request] of subscriptions)
        if (request.tag === WS_METHODS.subscribeZeropsAgentAuth)
          this.mate.chunk(socket, id, [encodeAuth(this.auth())]);
  }

  auth(): ZeropsAgentAuthSnapshot {
    if (this.signerOffboarded)
      return decodeAuth({
        available: true,
        agents: [
          {
            agentId: "codex",
            credPresent: false,
            flagOAuth: false,
            flagToken: false,
            providerAuth: "unauthenticated",
            state: "not-authorized",
            authorizedBy: { subject: "owner" },
          },
        ],
      });
    return decodeAuth({
      available: true,
      agents: [
        {
          agentId: "codex",
          credPresent: true,
          flagOAuth: this.ownership !== "project-token",
          flagToken: this.ownership === "project-token",
          providerAuth: "authenticated",
          state: this.ownership === "project-token" ? "authorized-token" : "authorized",
          ...(this.ownership === "unrecorded"
            ? {}
            : {
                authorizedBy: { subject: this.ownership === "colleague" ? "colleague" : "owner" },
              }),
        },
      ],
    });
  }

  history(text = "The existing conversation is still here") {
    this.wire.history(text);
  }

  approval() {
    this.wire.approval();
  }

  question() {
    this.wire.question();
  }

  waitForMessage(text: string) {
    return this.wire.waitForMessage(text);
  }
}

const chats = new WeakMap<MateFake, ChatDriver>();
export const installArea: ScenarioExtension = (drivers) => {
  drivers.onMate.push((mate) => chats.set(mate, new ChatDriver(mate)));
};
export function chatFor(mate: MateFake) {
  const chat = chats.get(mate);
  if (!chat) throw new Error("Install c-mate before creating projects");
  return chat;
}

/** A project grant disappears while its existing platform receiver keeps answering heartbeats. */
export async function revokeProjectAccess(drivers: ScenarioDrivers, name: string) {
  await drivers.zerops.waitForRegistration("project");
  const registration = [...drivers.zerops.subscriptions.values()].find(
    (entry) =>
      entry.kind === "project" && entry.output === "listStream" && entry.apiToken === "personal",
  );
  const socket = registration?.socket;
  if (socket === undefined || socket.readyState !== 1)
    throw new Error("A live personal receiver is required");
  let release = () => {};
  let received = () => {};
  let heartbeat = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const read = new Promise<void>((resolve) => {
    received = resolve;
  });
  const ping = new Promise<void>((resolve) => {
    heartbeat = resolve;
  });
  const onMessage = (raw: import("ws").RawData) => {
    if ((JSON.parse(String(raw)) as { type?: string }).type === "ping") heartbeat();
  };
  socket.on("message", onMessage);
  drivers.cleanup.push(async () => {
    release();
    socket.off("message", onMessage);
  });
  drivers.zerops.handlers.push(async (request) => {
    if (
      request.method !== "GET" ||
      request.url.pathname !== `/api/rest/public/project/${name}` ||
      request.headers.authorization !== "Bearer personal"
    )
      return undefined;
    received();
    await held;
    return drivers.zerops.error(403, "insufficientPermissions", "Project access was revoked.");
  });
  definePerson(drivers.zerops.world, "owner", { role: "NO_ACCESS", grants: { Bea: "BASIC_USER" } });
  const project = drivers.zerops.entities.get("project")?.get(name);
  if (project === undefined) throw new Error(`No project ${name}`);
  drivers.zerops.put("project", { ...project, userRoles: [] });
  await deadline(read, "read revoked project access");
  return {
    heartbeat: async () => {
      await deadline(ping, "existing platform receiver answered heartbeat");
      if (socket.readyState !== 1)
        throw new Error("Revocation closed the receiver before its REST verdict");
    },
    release,
  };
}
