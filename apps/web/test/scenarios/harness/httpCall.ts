// @effect-diagnostics nodeBuiltinImport:off -- the harness uses the real HTTP client boundary.
import * as NodeHttp from "node:http";
import * as NodeStreamConsumers from "node:stream/consumers";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";

type HealthStage = "handler" | "SQL" | "SQL complete" | "handler complete";

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
