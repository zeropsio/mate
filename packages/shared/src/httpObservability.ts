import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Headers from "effect/http/Headers";

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
