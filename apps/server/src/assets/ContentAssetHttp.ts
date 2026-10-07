import type { AssetRepresentation } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { HttpServerResponse } from "effect/unstable/http";

import { openMediaFile, streamMediaFile } from "./MediaFile.ts";

export const contentAssetFailure = (code: string, status: number) =>
  HttpServerResponse.jsonUnsafe(
    { code },
    { status, headers: { "Cache-Control": "no-store", Vary: "Origin" } },
  );

/** Called only after current session/access and a readable occurrence have been proved. */
export const contentAssetResponse = Effect.fn("contentAssetResponse")(function* (
  object: AssetRepresentation & { readonly path: string },
  request: {
    readonly method: string;
    readonly headers: Readonly<Record<string, string | undefined>>;
  },
) {
  const file = yield* openMediaFile(object.path).pipe(Effect.orElseSucceed(() => null));
  if (!file || file.info.size !== BigInt(object.sizeBytes))
    return contentAssetFailure("object-missing", 404);
  const etag = `"sha256-${object.digest}"`;
  const headers: Record<string, string> = {
    "Cache-Control": "private, no-cache",
    ETag: etag,
    Vary: "Origin",
    "X-Content-Type-Options": "nosniff",
    "Content-Type": object.mimeType,
    "Accept-Ranges": "bytes",
    ...(object.mimeType === "image/svg+xml"
      ? { "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox" }
      : {}),
  };
  if (
    request.headers["if-none-match"]
      ?.split(",")
      .some((tag) => tag.trim() === etag || tag.trim() === `W/${etag}` || tag.trim() === "*")
  )
    return HttpServerResponse.empty({ status: 304, headers });
  let start = 0;
  let end = object.sizeBytes - 1;
  let status = 200;
  if (
    request.method === "GET" &&
    request.headers.range &&
    (!request.headers["if-range"] || request.headers["if-range"] === etag)
  ) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
    if (match && (match[1] || match[2])) {
      start = match[1] ? Number(match[1]) : Math.max(0, object.sizeBytes - Number(match[2]));
      end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start > end ||
        start >= object.sizeBytes ||
        (!match[1] && Number(match[2]) === 0)
      )
        return HttpServerResponse.empty({
          status: 416,
          headers: { ...headers, "Content-Range": `bytes */${object.sizeBytes}` },
        });
      headers["Content-Range"] = `bytes ${start}-${end}/${object.sizeBytes}`;
      status = 206;
    }
  }
  headers["Content-Length"] = String(end - start + 1);
  if (request.method === "HEAD") return HttpServerResponse.empty({ status, headers });
  const body = streamMediaFile(file, BigInt(start), BigInt(end - start + 1));
  return body === null
    ? contentAssetFailure("unsupported", 413)
    : HttpServerResponse.stream(body, { status, headers });
});

/** Authorization is evaluated for every request, including validators, HEAD and ranges. */
export const protectedContentAsset = Effect.fn("protectedContentAsset")(function* <E, R>(
  authorization: Effect.Effect<null | HttpServerResponse.HttpServerResponse, E, R>,
  resolve: Effect.Effect<
    AssetRepresentation & { readonly path: string },
    HttpServerResponse.HttpServerResponse,
    R
  >,
  request: {
    readonly method: string;
    readonly headers: Readonly<Record<string, string | undefined>>;
  },
) {
  const denied = yield* authorization;
  if (denied !== null) return denied;
  return yield* resolve.pipe(
    Effect.flatMap((object) => contentAssetResponse(object, request)),
    Effect.catch((response) => Effect.succeed(response)),
  );
});
