import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Headers from "effect/http/Headers";
import * as HttpServerError from "effect/http/HttpServerError";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import type * as HttpServerResponse from "effect/http/HttpServerResponse";

export const httpHeaderRedactionLayer = Layer.effect(
  Headers.CurrentRedactedNames,
  Effect.map(Headers.CurrentRedactedNames, (names) => [...names, "dpop"]),
);

const REDACTED = "<redacted>";

// Socket tickets and proofs, pairing tokens, and OAuth codes travel in query strings.
const REDACTED_QUERY_PARAMS: ReadonlySet<string> = new Set([
  "wsTicket",
  "dpop",
  "token",
  "code",
  "state",
]);

const redactQuery = (query: string): string =>
  query
    .split("&")
    .map((pair) => {
      const separator = pair.indexOf("=");
      return separator !== -1 && REDACTED_QUERY_PARAMS.has(pair.slice(0, separator))
        ? `${pair.slice(0, separator)}=${REDACTED}`
        : pair;
    })
    .join("&");

const redactPath = (path: string, signedPathPrefixes: ReadonlyArray<string>): string => {
  for (const prefix of signedPathPrefixes) {
    if (!path.startsWith(`${prefix}/`)) continue;
    const rest = path.slice(prefix.length + 1);
    const segmentEnd = rest.indexOf("/");
    return `${prefix}/${REDACTED}${segmentEnd === -1 ? "" : rest.slice(segmentEnd)}`;
  }
  return path;
};

const redactUrl = (url: string, signedPathPrefixes: ReadonlyArray<string>): string => {
  const schemeEnd = url.indexOf("://");
  const pathStart = schemeEnd === -1 ? 0 : url.indexOf("/", schemeEnd + 3);
  if (pathStart === -1) return url;
  const target = url.slice(pathStart);
  const queryStart = target.indexOf("?");
  const path = queryStart === -1 ? target : target.slice(0, queryStart);
  return (
    url.slice(0, pathStart) +
    redactPath(path, signedPathPrefixes) +
    (queryStart === -1 ? "" : `?${redactQuery(target.slice(queryStart + 1))}`)
  );
};

/**
 * Rewrites the `url.*` span attributes and the `http.url` log annotation so
 * credential query parameters and the signed token segment after any of
 * `signedPathPrefixes` never reach a trace.
 * The tracer applies it to every span, server and client alike.
 */
export const makeUrlAttributeRedactor =
  (signedPathPrefixes: ReadonlyArray<string>) =>
  (key: string, value: unknown): unknown => {
    if (typeof value !== "string") return value;
    switch (key) {
      case "url.full":
      // The HTTP logger's annotation, which reaches traces as a span event attribute.
      case "http.url":
        return redactUrl(value, signedPathPrefixes);
      case "url.path":
        return redactPath(value, signedPathPrefixes);
      case "url.query":
        return redactQuery(value);
      default:
        return value;
    }
  };

const stripSearchAndHash = (url: string): string => {
  const end = url.search(/[?#]/u);
  return end === -1 ? url : url.slice(0, end);
};

/**
 * Effect's HTTP response logger (`HttpMiddleware.logger`) with its `http.url`
 * annotation passed through {@link makeUrlAttributeRedactor}, so the server's
 * own log lines never carry the signed token segment either. Pass it to
 * `HttpRouter.serve` as `middleware` with `disableLogger: true`.
 */
export const makeRedactedHttpLogger = (signedPathPrefixes: ReadonlyArray<string>) => {
  const redact = makeUrlAttributeRedactor(signedPathPrefixes);
  return <E, R>(
    httpApp: Effect.Effect<
      HttpServerResponse.HttpServerResponse,
      E,
      HttpServerRequest.HttpServerRequest | R
    >,
  ): Effect.Effect<
    HttpServerResponse.HttpServerResponse,
    E,
    HttpServerRequest.HttpServerRequest | R
  > =>
    Effect.withFiber((fiber) => {
      const request = Context.getUnsafe(fiber.context, HttpServerRequest.HttpServerRequest);
      const annotations = (status: number) => ({
        "http.method": request.method,
        "http.url": redact("http.url", stripSearchAndHash(request.url)),
        "http.status": status,
      });
      return Effect.withLogSpan(
        Effect.flatMap(Effect.exit(httpApp), (exit) => {
          if (exit._tag === "Success") {
            return Effect.andThen(
              Effect.annotateLogs(Effect.log("Sent HTTP response"), annotations(exit.value.status)),
              exit,
            );
          }
          const [response, cause] = HttpServerError.causeResponseStripped(exit.cause);
          // A client that hung up is not a server failure worth its cause.
          const message =
            Option.isSome(cause) &&
            !cause.value.reasons.every(
              (reason) =>
                reason._tag === "Interrupt" &&
                reason.annotations.has(HttpServerError.ClientAbort.key),
            )
              ? cause.value
              : "Sent HTTP response";
          return Effect.andThen(
            Effect.annotateLogs(Effect.log(message), annotations(response.status)),
            exit,
          );
        }),
        "http.span",
      );
    });
};
