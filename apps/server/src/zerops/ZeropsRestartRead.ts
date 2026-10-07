/** Startup evidence, read once with this Mate's own key, never retried. */
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as HttpClient from "effect/unstable/http/HttpClient";

import * as ServerConfig from "../config.ts";
import { ZeropsMateKey } from "./ZeropsMateKey.ts";
import { ZeropsOrgRead } from "./ZeropsOrgRead.ts";
import {
  readJson,
  unavailable,
  zeropsGet,
  type ZeropsApiUnavailableError,
} from "./zeropsApiRead.ts";

export interface MateRestartEvidence {
  readonly name: string;
  readonly projectId: string;
  readonly serviceId: string;
  readonly processes: ReadonlyArray<unknown>;
  readonly containerStartedAt: string | null;
}

export class ZeropsRestartRead extends Context.Service<
  ZeropsRestartRead,
  { readonly read: Effect.Effect<MateRestartEvidence, ZeropsApiUnavailableError> }
>()("t3/zerops/ZeropsRestartRead") {}

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

/** Linux reports PID 1's start in USER_HZ (100 ticks/s), relative to the host boot time. */
export function containerStartedAt(stat: string, hostStat: string): string | null {
  if (!stat.startsWith("1 (") || !stat.includes(") ")) return null;
  // comm is parenthesized and may itself contain spaces and parentheses.
  const fields = stat
    .slice(stat.lastIndexOf(")") + 2)
    .trim()
    .split(/\s+/);
  const ticks = Number(fields[19]); // field 22; the first field after comm is field 3
  const boot = /^btime (\d+)$/m.exec(hostStat)?.[1];
  if (boot === undefined || !Number.isFinite(ticks) || ticks < 0) return null;
  return DateTime.formatIso(DateTime.makeUnsafe((Number(boot) + ticks / 100) * 1000));
}

export const make = Effect.fnUntraced(function* (input: {
  readonly serviceId: string | undefined;
}) {
  const config = yield* ServerConfig.ServerConfig;
  const own = yield* ZeropsOrgRead;
  const key = yield* ZeropsMateKey;
  const httpClient = yield* HttpClient.HttpClient;
  const fs = yield* FileSystem.FileSystem;
  const environment = config.zerops;
  const serviceId = input.serviceId;

  const read = Effect.gen(function* () {
    if (environment === undefined || serviceId === undefined) {
      return yield* Effect.fail(unavailable("This Mate's container identity is unavailable."));
    }
    const token = yield* key.read;
    if (token === undefined) return yield* Effect.fail(unavailable("This Mate has no Zerops key."));
    // The direct endpoint carries finished processes too, without search-index lag. The key's
    // usual 401 retry is deliberately bypassed: startup makes one attempt and settles the turn.
    const response = yield* zeropsGet({
      url: `${environment.apiBaseUrl}/project/${encodeURIComponent(environment.projectId)}/process?limit=1000`,
      token,
    });
    if (response.status !== 200)
      return yield* Effect.fail(unavailable("Zerops could not explain this restart."));
    const body = yield* readJson(response);
    const processes = record(body)?.["list"];
    if (!Array.isArray(processes))
      return yield* Effect.fail(unavailable("Zerops returned an unreadable process list."));
    // Reuse the project document already shared by the door and membership readers.
    const project = yield* own.project({
      apiBaseUrl: environment.apiBaseUrl,
      projectId: environment.projectId,
    });
    const name =
      project.kind === "answered" && project.status === 200
        ? (text(record(project.body)?.["name"]) ?? "Mate")
        : "Mate";
    const startedAt = yield* Effect.gen(function* () {
      const stat = yield* fs.readFileString("/proc/1/stat");
      const hostStat = yield* fs.readFileString("/proc/stat");
      return containerStartedAt(stat, hostStat);
    }).pipe(Effect.catch(() => Effect.succeed(null)));
    return {
      name,
      projectId: environment.projectId,
      serviceId,
      processes,
      containerStartedAt: startedAt,
    };
  }).pipe(
    Effect.provideService(HttpClient.HttpClient, httpClient),
    Effect.timeout("5 seconds"),
    Effect.catchTag("TimeoutError", () =>
      Effect.fail(unavailable("The Zerops restart read timed out.")),
    ),
  );
  return ZeropsRestartRead.of({ read });
});

export const layer = Layer.effect(ZeropsRestartRead, make({ serviceId: process.env["serviceId"] }));

/** The newest completed container action within this turn's interruption window. */
export function interruptedTurnMessage(input: {
  readonly evidence: MateRestartEvidence | null;
  readonly lastActivityAt: string;
  readonly bootAt: string;
}): string {
  return `${restartCause(input)}; its running turn was interrupted. Send a message to continue.`;
}

/**
 * What happened to the Mate between a turn's last sign of life and the boot: the newest completed
 * container action in that window, its container's replacement, or a plain restart.
 */
export function restartCause(input: {
  readonly evidence: MateRestartEvidence | null;
  readonly lastActivityAt: string;
  readonly bootAt: string;
}): string {
  const { evidence, bootAt } = input;
  const after = Date.parse(input.lastActivityAt);
  const before = Date.parse(bootAt);
  const inWindow = (time: string | null): time is string =>
    time !== null && Date.parse(time) > after && Date.parse(time) < before;
  const matched = evidence?.processes
    .flatMap((value) => {
      const process = record(value);
      if (process === null || process["status"] !== "FINISHED") return [];
      const action = text(process["actionName"]);
      if (
        action !== "stack.restart" &&
        action !== "stack.stop" &&
        action !== "stack.deploy" &&
        action !== "stack.deploy.backup"
      )
        return [];
      if (process["projectId"] !== undefined && process["projectId"] !== evidence.projectId)
        return [];
      const services = process["serviceStacks"];
      if (
        process["serviceStackId"] !== evidence.serviceId &&
        !(
          Array.isArray(services) &&
          services.some((service) => record(service)?.["id"] === evidence.serviceId)
        )
      )
        return [];
      // started is the action's time, not finished (the server may boot during the restart).
      const at = text(process["started"]) ?? text(process["created"]);
      if (!inWindow(at)) return [];
      const user = record(process["createdByUser"]);
      const person = text(user?.["fullName"]) ?? text(user?.["firstName"]);
      return [{ at, person, action }];
    })
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
  const name = evidence?.name ?? "Mate";
  if (matched !== undefined) {
    const verb =
      matched.action === "stack.stop"
        ? "stopped"
        : matched.action.startsWith("stack.deploy")
          ? "redeployed"
          : "restarted";
    return `${name} was ${verb}${matched.person === null ? "" : ` by ${matched.person}`} at ${matched.at}`;
  }
  if (inWindow(evidence?.containerStartedAt ?? null)) {
    return `${name}'s container was replaced at ${evidence!.containerStartedAt}`;
  }
  return `${name} restarted at ${bootAt}`;
}
