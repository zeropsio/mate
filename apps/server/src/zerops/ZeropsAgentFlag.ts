/**
 * ZeropsAgentFlag — the mate server as the one writer of the Zerops
 * "agent signed in" platform flag.
 *
 * Replaces `zcp agent mark-oauth <agent>` (the old `ZeropsCli.markAgentOAuth`
 * spawn): this server now writes the SERVICE-scope user-data env row
 * `ZCP_AGENT_OAUTH_<SUFFIX>` on the Mate's own zcp service directly, with
 * the Mate's own key (`ZeropsMateKey`):
 *   - `GET  {apiBaseUrl}/service-stack/{serviceId}/env` — the service's own
 *     user-data rows (`id`, `key`, `content`, `sensitive`, `type`).
 *   - `POST {apiBaseUrl}/service-stack/{serviceId}/user-data` — body
 *     `{key, content, sensitive}`, returns a Process
 *     (`stack.updateUserData`).
 *   - `DELETE {apiBaseUrl}/user-data/{id}`.
 *
 * The row MUST be written `sensitive:false`: the Zerops GUI's own read path
 * redacts a sensitive row and then reports "not authorized" reading it back.
 *
 * Upsert rule — ports `../zcp/internal/ops/agent_oauth.go`'s
 * `MarkAgentOAuth` semantics, not its code:
 *  - absent -> create
 *  - present, non-sensitive, content "true" -> no-op
 *  - present with any other value, OR sensitive -> delete + recreate
 *    non-sensitive
 *
 * `clearSignedIn` (sign-out) deletes that row if present, and also deletes
 * `ZCP_AGENT_AUTH_TYPE_<SUFFIX>` (GUI-written metadata, "oauth"|"token")
 * but only when ITS content is "oauth" — a token-authorized agent's
 * AUTH_TYPE row belongs to the project's own token, not to this flow.
 *
 * @module ZeropsAgentFlag
 */
import type { ZeropsAgentId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as HttpClient from "effect/http/HttpClient";

import * as ServerConfig from "../config.ts";
import type { ProcessLiveEvent } from "./ZeropsProjectSocket.ts";
import type { ZeropsEnvironment } from "./ZeropsEnvironment.ts";
import { ZeropsProjectFeed } from "./ZeropsProjectFeed.ts";
import * as ZeropsMateKeyModule from "./ZeropsMateKey.ts";
import { requestWithMateKey } from "./ZeropsMateKey.ts";
import { readJson, zeropsGet } from "./zeropsApiRead.ts";
import { zeropsDelete, zeropsPost } from "./zeropsApiWrite.ts";

/**
 * `ZCP_AGENT_OAUTH_<SUFFIX>` / `ZCP_AGENT_AUTH_TYPE_<SUFFIX>` suffixes —
 * duplicated deliberately from `ZeropsAgentAuth.ts`'s own
 * `AGENT_OAUTH_SUFFIX` (itself already a documented, deliberate duplicate of
 * the Go side's `agentOAuthSuffixes` map). That module READS the flag out of
 * the platform's zembed env store; this one WRITES it through the API.
 * Neither imports the other, so a write-path change never risks the read
 * feed (and vice versa).
 */
const AGENT_OAUTH_SUFFIX: Readonly<Record<ZeropsAgentId, string>> = {
  "claude-code": "CLAUDE_CODE",
  codex: "CODEX",
};

export const oauthFlagKey = (agentId: ZeropsAgentId): string =>
  `ZCP_AGENT_OAUTH_${AGENT_OAUTH_SUFFIX[agentId]}`;

export const authTypeFlagKey = (agentId: ZeropsAgentId): string =>
  `ZCP_AGENT_AUTH_TYPE_${AGENT_OAUTH_SUFFIX[agentId]}`;

/** One row of the service's SERVICE-scope user-data env list. */
export interface ServiceEnvRow {
  readonly id: string;
  readonly key: string;
  readonly content: string;
  readonly sensitive: boolean;
}

// ---------------------------------------------------------------------------
// Pure planning
// ---------------------------------------------------------------------------

export type MarkSignedInPlan =
  | { readonly action: "noop" }
  | { readonly action: "create" }
  | { readonly action: "recreate"; readonly deleteId: string };

/** The upsert rule, given the service's current env rows. */
export const planMarkSignedIn = (
  env: ReadonlyArray<ServiceEnvRow>,
  agentId: ZeropsAgentId,
): MarkSignedInPlan => {
  const key = oauthFlagKey(agentId);
  const existing = env.find((row) => row.key === key);
  if (existing === undefined) {
    return { action: "create" };
  }
  if (!existing.sensitive && existing.content === "true") {
    return { action: "noop" };
  }
  return { action: "recreate", deleteId: existing.id };
};

export interface ClearSignedInPlan {
  readonly deleteOAuthId: string | undefined;
  readonly deleteAuthTypeId: string | undefined;
}

/** What to delete for a sign-out, given the service's current env rows. */
export const planClearSignedIn = (
  env: ReadonlyArray<ServiceEnvRow>,
  agentId: ZeropsAgentId,
): ClearSignedInPlan => {
  const oauthRow = env.find((row) => row.key === oauthFlagKey(agentId));
  const authTypeRow = env.find((row) => row.key === authTypeFlagKey(agentId));
  return {
    deleteOAuthId: oauthRow?.id,
    deleteAuthTypeId:
      authTypeRow !== undefined && authTypeRow.content === "oauth" ? authTypeRow.id : undefined,
  };
};

// ---------------------------------------------------------------------------
// I/O
// ---------------------------------------------------------------------------

/** A failure to read or write the service's own env — network, a bad status, or this container's own service id being unavailable. */
export class ZeropsAgentFlagError extends Schema.TaggedError<ZeropsAgentFlagError>()(
  "ZeropsAgentFlagError",
  {
    reason: Schema.String,
    process: Schema.optional(
      Schema.Struct({
        id: Schema.String,
        status: Schema.optional(Schema.String),
        reason: Schema.optional(Schema.String),
      }),
    ),
  },
) {
  override get message(): string {
    return this.reason;
  }
}

export interface RegistrationProcess {
  readonly id: string;
  readonly status?: string;
  readonly reason?: string;
}

/** The Mate's process frames, subscribed when this runs (`ZeropsProjectFeed.processes`). */
export type ProcessEvents = Effect.Effect<Stream.Stream<ProcessLiveEvent>, never, Scope.Scope>;

export interface MarkSignedInResult {
  readonly key: string;
  readonly changed: boolean;
  /** True when an existing (wrong-valued or sensitive) row had to be replaced, rather than created fresh. */
  readonly migrated: boolean;
  readonly process?: RegistrationProcess;
}

/**
 * Tolerant row decode: an entry missing a required field, or of the wrong
 * shape, drops out rather than poisoning the whole read — the same
 * tolerance `ZeropsProjectSigners.ts`'s member parsing uses for a
 * platform list this server does not fully own.
 */
export const readServiceEnvRows = (body: unknown): ReadonlyArray<ServiceEnvRow> | undefined => {
  if (typeof body !== "object" || body === null) return undefined;
  const items = (body as { readonly items?: unknown }).items;
  if (!Array.isArray(items)) return undefined;
  const rows: Array<ServiceEnvRow> = [];
  for (const entry of items) {
    if (typeof entry !== "object" || entry === null) continue;
    const { id, key, content, sensitive } = entry as Record<string, unknown>;
    if (
      typeof id === "string" &&
      typeof key === "string" &&
      typeof content === "string" &&
      typeof sensitive === "boolean"
    ) {
      rows.push({ id, key, content, sensitive });
    }
  }
  return rows;
};

const readServiceEnv = Effect.fn("ZeropsAgentFlag.readEnv")(function* (input: {
  readonly apiBaseUrl: string;
  readonly serviceId: string;
}) {
  const mateKey = yield* ZeropsMateKeyModule.ZeropsMateKey;
  const { response } = yield* requestWithMateKey(mateKey, (token) =>
    zeropsGet({
      url: `${input.apiBaseUrl}/service-stack/${encodeURIComponent(input.serviceId)}/env`,
      token,
    }),
  ).pipe(
    Effect.catchTags({
      ZeropsApiUnavailableError: () => Effect.succeed({ token: undefined, response: undefined }),
    }),
  );
  if (response === undefined || response.status !== 200) return undefined;
  const body = yield* readJson(response).pipe(
    Effect.catchTags({ ZeropsApiUnavailableError: () => Effect.succeed(undefined) }),
  );
  return readServiceEnvRows(body);
});

/** Platform process messages are user-facing; cap them and remove control characters. */
const registrationProcessReason = (body: unknown): string | undefined => {
  if (typeof body !== "object" || body === null || !("error" in body)) return undefined;
  const error = body.error;
  if (
    typeof error !== "object" ||
    error === null ||
    !("message" in error) ||
    typeof error.message !== "string"
  )
    return undefined;
  const message = error.message.replace(/\p{C}/gu, " ").trim().slice(0, 500);
  return message.length === 0 ? undefined : message;
};

const createUserDataRow = Effect.fn("ZeropsAgentFlag.createRow")(function* (input: {
  readonly apiBaseUrl: string;
  readonly serviceId: string;
  readonly key: string;
  readonly content: string;
}) {
  const mateKey = yield* ZeropsMateKeyModule.ZeropsMateKey;
  const { response } = yield* requestWithMateKey(mateKey, (token) =>
    zeropsPost({
      url: `${input.apiBaseUrl}/service-stack/${encodeURIComponent(input.serviceId)}/user-data`,
      token,
      body: { key: input.key, content: input.content, sensitive: false },
    }),
  ).pipe(
    Effect.catchTags({
      ZeropsApiUnavailableError: () => Effect.succeed({ token: undefined, response: undefined }),
    }),
  );
  if (response === undefined || response.status !== 200) {
    return yield* new ZeropsAgentFlagError({ reason: `Could not write ${input.key}.` });
  }
  const body = yield* readJson(response).pipe(
    Effect.catchTags({ ZeropsApiUnavailableError: () => Effect.succeed(undefined) }),
  );
  if (
    typeof body !== "object" ||
    body === null ||
    !("id" in body) ||
    typeof body.id !== "string" ||
    body.id.length === 0
  ) {
    return yield* new ZeropsAgentFlagError({
      reason: "Zerops did not return a registration process.",
    });
  }
  const reason = registrationProcessReason(body);
  return {
    id: body.id,
    ...("status" in body && typeof body.status === "string" ? { status: body.status } : {}),
    ...(reason === undefined ? {} : { reason }),
  };
});

const deleteUserDataRow = Effect.fn("ZeropsAgentFlag.deleteRow")(function* (input: {
  readonly apiBaseUrl: string;
  readonly id: string;
}) {
  const mateKey = yield* ZeropsMateKeyModule.ZeropsMateKey;
  const { response } = yield* requestWithMateKey(mateKey, (token) =>
    zeropsDelete({ url: `${input.apiBaseUrl}/user-data/${encodeURIComponent(input.id)}`, token }),
  ).pipe(
    Effect.catchTags({
      ZeropsApiUnavailableError: () => Effect.succeed({ token: undefined, response: undefined }),
    }),
  );
  if (response === undefined || response.status !== 200) {
    return yield* new ZeropsAgentFlagError({ reason: `Could not delete row ${input.id}.` });
  }
});

const PROCESS_STATUSES = [
  "PENDING",
  "RUNNING",
  "ROLLBACKING",
  "CANCELING",
  "FINISHED",
  "FAILED",
  "CANCELED",
];

/** The registration process `id` as `body` (a read's answer or a frame's row) states it, if it does. */
const registrationOf = (id: string, body: unknown): RegistrationProcess | undefined => {
  const status =
    typeof body === "object" && body !== null && "status" in body ? body.status : undefined;
  if (typeof status !== "string" || !PROCESS_STATUSES.includes(status)) return undefined;
  const reason = registrationProcessReason(body);
  return { id, status, ...(reason === undefined ? {} : { reason }) };
};

const unreadable = (process: RegistrationProcess) =>
  new ZeropsAgentFlagError({
    reason: "Could not read the registration process. Check its outcome before registering again.",
    process,
  });

const ended = (process: RegistrationProcess): boolean =>
  process.status === "FINISHED" || process.status === "FAILED" || process.status === "CANCELED";

/**
 * Follow only the accepted process id. It is read once the Mate's process frames are subscribed
 * (covering a process that ended before any frame could arrive) and again after each socket
 * (re)connect; otherwise its frames say how it goes. A failed read ends this attempt; no new
 * write is made.
 */
const followRegistration = (
  apiBaseUrl: string,
  accepted: RegistrationProcess,
  processes: ProcessEvents,
  onAccepted?: (process: RegistrationProcess) => Effect.Effect<void>,
) =>
  Effect.gen(function* () {
    const mateKey = yield* ZeropsMateKeyModule.ZeropsMateKey;
    const read = Effect.gen(function* () {
      const { response } = yield* requestWithMateKey(mateKey, (token) =>
        zeropsGet({
          url: `${apiBaseUrl}/process/${encodeURIComponent(accepted.id)}`,
          token,
        }),
      ).pipe(
        Effect.timeout("5 seconds"),
        Effect.catchCause(() => Effect.succeed({ response: undefined })),
      );
      const body =
        response?.status === 200
          ? yield* readJson(response).pipe(
              Effect.timeout("5 seconds"),
              Effect.orElseSucceed(() => undefined),
            )
          : undefined;
      const process = registrationOf(accepted.id, body);
      if (process !== undefined) return process;
      return yield* unreadable(accepted);
    });
    /** What a socket event says of the process: a fresh read after a (re)connect, else its frame row. */
    const heard = (event: ProcessLiveEvent) =>
      event._tag === "connected"
        ? read
        : Effect.succeed(
            registrationOf(
              accepted.id,
              event.processes.findLast((process) => process.id === accepted.id)?.row,
            ),
          );
    const updates = ended(accepted)
      ? Stream.empty
      : Stream.concat(Stream.fromEffect(read), Stream.mapEffect(yield* processes, heard));
    const last = yield* Stream.concat(Stream.make(accepted), updates).pipe(
      Stream.filter((process): process is RegistrationProcess => process !== undefined),
      Stream.changesWith((a, b) => a.status === b.status && a.reason === b.reason),
      Stream.tap((process) => onAccepted?.(process) ?? Effect.void),
      Stream.filter(ended),
      Stream.runHead,
    );
    if (Option.isNone(last)) return yield* unreadable(accepted);
    const process = last.value;
    if (process.status === "FINISHED") return process;
    return yield* new ZeropsAgentFlagError({
      reason:
        process.reason ??
        (process.status === "FAILED"
          ? "Zerops registration failed."
          : "Zerops registration was canceled."),
      process,
    });
  }).pipe(Effect.scoped);

/** `markSignedIn`'s I/O, testable directly against a mocked `HttpClient` without a `ZeropsAgentFlag` layer. */
export const markSignedIn = Effect.fn("ZeropsAgentFlag.markSignedIn")(function* (input: {
  readonly environment: ZeropsEnvironment;
  readonly serviceId: string | undefined;
  readonly agentId: ZeropsAgentId;
  readonly processes: ProcessEvents;
  readonly onAccepted?: (process: RegistrationProcess) => Effect.Effect<void>;
}) {
  if (input.serviceId === undefined) {
    return yield* new ZeropsAgentFlagError({
      reason: "This container's own service id is unavailable.",
    });
  }
  const { apiBaseUrl } = input.environment;
  const env = yield* readServiceEnv({ apiBaseUrl, serviceId: input.serviceId });
  if (env === undefined) {
    return yield* new ZeropsAgentFlagError({
      reason: "Could not read the service's own environment.",
    });
  }
  const key = oauthFlagKey(input.agentId);
  const plan = planMarkSignedIn(env, input.agentId);
  if (plan.action === "recreate") {
    yield* deleteUserDataRow({ apiBaseUrl, id: plan.deleteId });
  }
  const process =
    plan.action === "noop"
      ? undefined
      : yield* createUserDataRow({
          apiBaseUrl,
          serviceId: input.serviceId,
          key,
          content: "true",
        }).pipe(
          Effect.flatMap((process) =>
            followRegistration(apiBaseUrl, process, input.processes, input.onAccepted),
          ),
        );
  return {
    key,
    changed: plan.action !== "noop",
    migrated: plan.action === "recreate",
    ...(process === undefined ? {} : { process }),
  } satisfies MarkSignedInResult;
});

/** `clearSignedIn`'s I/O, testable directly against a mocked `HttpClient` without a `ZeropsAgentFlag` layer. */
export const clearSignedIn = Effect.fn("ZeropsAgentFlag.clearSignedIn")(function* (input: {
  readonly environment: ZeropsEnvironment;
  readonly serviceId: string | undefined;
  readonly agentId: ZeropsAgentId;
}) {
  if (input.serviceId === undefined) {
    return yield* new ZeropsAgentFlagError({
      reason: "This container's own service id is unavailable.",
    });
  }
  const { apiBaseUrl } = input.environment;
  const env = yield* readServiceEnv({ apiBaseUrl, serviceId: input.serviceId });
  if (env === undefined) {
    return yield* new ZeropsAgentFlagError({
      reason: "Could not read the service's own environment.",
    });
  }
  const plan = planClearSignedIn(env, input.agentId);
  if (plan.deleteOAuthId !== undefined) {
    yield* deleteUserDataRow({ apiBaseUrl, id: plan.deleteOAuthId });
  }
  if (plan.deleteAuthTypeId !== undefined) {
    yield* deleteUserDataRow({ apiBaseUrl, id: plan.deleteAuthTypeId });
  }
});

export class ZeropsAgentFlag extends Context.Service<
  ZeropsAgentFlag,
  {
    readonly markSignedIn: (
      agentId: ZeropsAgentId,
      onAccepted?: (process: RegistrationProcess) => Effect.Effect<void>,
    ) => Effect.Effect<MarkSignedInResult, ZeropsAgentFlagError>;
    readonly clearSignedIn: (agentId: ZeropsAgentId) => Effect.Effect<void, ZeropsAgentFlagError>;
  }
>()("t3/zerops/ZeropsAgentFlag") {}

export const make = (options: {
  readonly environment: ZeropsEnvironment;
  readonly serviceId: string | undefined;
}) =>
  Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient;
    const mateKey = yield* ZeropsMateKeyModule.ZeropsMateKey;
    const { processes } = yield* ZeropsProjectFeed;
    const withHttp = <A, E>(
      effect: Effect.Effect<A, E, HttpClient.HttpClient | ZeropsMateKeyModule.ZeropsMateKey>,
    ) =>
      effect.pipe(
        Effect.provideService(HttpClient.HttpClient, httpClient),
        Effect.provideService(ZeropsMateKeyModule.ZeropsMateKey, mateKey),
      );

    return ZeropsAgentFlag.of({
      markSignedIn: (agentId, onAccepted) =>
        withHttp(
          markSignedIn({
            environment: options.environment,
            serviceId: options.serviceId,
            agentId,
            processes,
            ...(onAccepted === undefined ? {} : { onAccepted }),
          }),
        ),
      clearSignedIn: (agentId) =>
        withHttp(
          clearSignedIn({
            environment: options.environment,
            serviceId: options.serviceId,
            agentId,
          }),
        ),
    });
  });

/**
 * Live only: `config.zerops` absent (not a Zerops environment) never
 * constructs a service that would try an HTTP call — every method fails
 * fast instead. The service id is this container's own (`ZeropsEnvironment.serviceId`).
 */
export const layer = Layer.effect(
  ZeropsAgentFlag,
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const environment = config.zerops;
    if (environment === undefined) {
      const notZerops = new ZeropsAgentFlagError({ reason: "Not a Zerops environment." });
      return ZeropsAgentFlag.of({
        markSignedIn: () => Effect.fail(notZerops),
        clearSignedIn: () => Effect.fail(notZerops),
      });
    }
    return yield* make({ environment, serviceId: environment.serviceId });
  }),
);
