// @effect-diagnostics nodeBuiltinImport:off -- the harness uses the real HTTP client boundary.
import * as NodeHttp from "node:http";
import * as NodeStreamConsumers from "node:stream/consumers";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";

import type { HealthStage } from "../../src/health.ts";

export type ReadinessStep =
  | "connect"
  | "request written"
  | "response headers"
  | "body"
  | HealthStage;
export const READINESS_HEADER = "x-hq-readiness-id";

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeJson = Schema.decodeSync(Schema.fromJsonString(Schema.Unknown));

export const makeHttpCall = (
  base: string,
  agent: NodeHttp.Agent,
  observers = new Map<string, (step: ReadinessStep) => void>(),
) => {
  let requestId = 0;
  return (
    method: string,
    path: string,
    options: {
      /** JSON, or bytes sent as they are (their `content-type` among the headers). */
      readonly body?: unknown;
      readonly session?: string;
      readonly headers?: Record<string, string>;
      /** Ends the call from the client's side, as a browser that gave up does. */
      readonly signal?: AbortSignal;
      readonly onReadinessStep?: (step: ReadinessStep) => void;
    } = {},
  ) =>
    Effect.promise(async () => {
      const raw = options.body instanceof Uint8Array;
      const observer = options.onReadinessStep;
      const id = observer === undefined ? undefined : String(++requestId);
      if (id !== undefined && observer !== undefined) observers.set(id, observer);
      try {
        // Node's HTTP client returns each redirect as an answer, without following it.
        const response = await new Promise<NodeHttp.IncomingMessage>((resolve, reject) => {
          const request = NodeHttp.request(
            `http://${base}${path}`,
            {
              method,
              agent,
              ...(options.signal === undefined ? {} : { signal: options.signal }),
              headers: {
                ...(options.body === undefined || raw
                  ? {}
                  : { "content-type": "application/json" }),
                ...(options.session === undefined
                  ? {}
                  : { authorization: `Bearer ${options.session}` }),
                ...options.headers,
                ...(id === undefined ? {} : { [READINESS_HEADER]: id }),
              },
            },
            (response) => {
              observer?.("response headers");
              resolve(response);
            },
          );
          if (observer !== undefined) {
            request.once("socket", (socket) => {
              if (socket.connecting) socket.once("connect", () => observer("connect"));
              else observer("connect");
            });
            request.once("finish", () => observer("request written"));
          }
          request.once("error", reject);
          request.end(
            options.body === undefined
              ? undefined
              : options.body instanceof Uint8Array
                ? options.body
                : encodeJson(options.body),
          );
        });
        if (response.statusCode === undefined) throw new Error("Core's HTTP answer has no status");
        const headers = new Headers();
        for (let index = 0; index < response.rawHeaders.length; index += 2) {
          headers.append(response.rawHeaders[index]!, response.rawHeaders[index + 1]!);
        }
        const bytes = new Uint8Array(await NodeStreamConsumers.arrayBuffer(response));
        observer?.("body");
        const text = new TextDecoder().decode(bytes);
        const isJson = headers.get("content-type")?.includes("json") ?? false;
        return {
          status: response.statusCode,
          body: text === "" ? null : isJson ? decodeJson(text) : text,
          bytes,
          headers,
        };
      } finally {
        if (id !== undefined) observers.delete(id);
      }
    });
};

export type Call = ReturnType<typeof makeHttpCall>;

export const untilHealth = (call: Call, state: string) =>
  Effect.suspend(() => {
    let attempts = 0;
    let current = { started: "", steps: [] as Array<{ step: ReadinessStep; at: number }> };
    let lastState: unknown;
    return Effect.suspend(() => {
      attempts++;
      const startedAt = performance.now();
      const attempt = {
        started: DateTime.formatIso(DateTime.makeUnsafe(performance.timeOrigin + startedAt)),
        steps: [] as Array<{ step: ReadinessStep; at: number }>,
      };
      current = attempt;
      return call("GET", "/health", {
        onReadinessStep: (step) =>
          attempt.steps.push({ step, at: Math.round(performance.now() - startedAt) }),
      }).pipe(
        Effect.catchDefect((defect) =>
          typeof defect === "object" &&
          defect !== null &&
          "code" in defect &&
          (defect.code === "ECONNRESET" || defect.code === "ECONNREFUSED")
            ? Effect.fail(defect)
            : Effect.die(defect),
        ),
        Effect.tap((response) =>
          Effect.sync(() => {
            lastState =
              response.body !== null &&
              typeof response.body === "object" &&
              "state" in response.body
                ? response.body.state
                : undefined;
          }),
        ),
      );
    }).pipe(
      Effect.filterOrFail(
        (response) =>
          response.body !== null &&
          typeof response.body === "object" &&
          "state" in response.body &&
          response.body.state === state,
      ),
      Effect.retry(Schedule.spaced(Duration.millis(50))),
      Effect.timeoutOrElse({
        duration: Duration.seconds(10),
        orElse: () => {
          const reached = (step: ReadinessStep) =>
            current.steps.some((entry) => entry.step === step);
          const handler = current.steps
            .filter(
              (entry) =>
                entry.step === "handler" ||
                entry.step === "SQL" ||
                entry.step === "SQL complete" ||
                entry.step === "handler complete",
            )
            .at(-1)?.step;
          const stalled = reached("body")
            ? `readiness state (expected ${state}, last ${String(lastState)})`
            : reached("response headers")
              ? "body"
              : handler === "SQL"
                ? "SQL"
                : handler !== undefined && handler !== "handler complete"
                  ? "SQL/handler"
                  : reached("request written")
                    ? "response headers"
                    : reached("connect")
                      ? "request written"
                      : "connect";
          const timeline = current.steps.map(({ step, at }) => `${step} @ ${at}ms`).join(", ");
          return Effect.fail(
            new Cause.TimeoutError(
              `HQ setup readiness timed out after 10s; attempt ${attempts} started ${current.started}; stalled step: ${stalled}; ${timeline}; SQL/handler: ${handler ?? "unobserved"}`,
            ),
          );
        },
      }),
    );
  });
