/**
 * The Git browser's reads, `GET /api/apps/:appId/repos/:repo/browse/<read>`: the only HTTP path to
 * a repository's content beside git itself. Each read is a module of this folder and one line in
 * {@link BROWSE_READS}; every one takes from the person's browse bucket (`rateLimit.ts`), checks
 * the person's access before any git runs (`access.ts`), and ends at its deadline, its git stopped
 * with it.
 *
 * An answer pinned to a commit never changes, so it says so and answers a matching
 * `If-None-Match` with `304`; an answer about refs (`home`, `refs`) is never cached. A file's
 * bytes (`raw`) go out as plain text, an image or an octet stream, never anything a browser runs.
 *
 * @module gitBrowse/routes
 */
import { RepoName } from "@t3tools/shared/hqChanges";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { handle, principal } from "../api.ts";
import { BROWSE_LIMIT, DoorRateLimit, TooManyRequests } from "../rateLimit.ts";
import { blobRead } from "./blob.ts";
import { commitRead } from "./commit.ts";
import { commitFileRead } from "./commitFile.ts";
import { compareFileRead, compareRead } from "./compare.ts";
import { grepRead } from "./grep.ts";
import { browseHeavyLayer } from "./heavy.ts";
import { homeRead } from "./home.ts";
import { logRead } from "./log.ts";
import { rawRead } from "./raw.ts";
import { pathsRead } from "./paths.ts";
import { refsRead } from "./refs.ts";
import { BrowseRefused } from "./refused.ts";
import { treeRead } from "./tree.ts";

export interface BrowseAnswer {
  readonly body: unknown;
  /** The commit the answer is wholly about; none for one that moves with a ref. */
  readonly pinned: { readonly sha: string } | null;
}

/** A file's bytes: immutable, tagged by the file's content id. */
export interface BrowseBytes {
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly blobSha: string;
  /** Sent as a download of this name. */
  readonly download: string | null;
}

const isBytes = (answer: BrowseAnswer | BrowseBytes): answer is BrowseBytes => "bytes" in answer;

/** What a read is asked: by whom, of which repository, and its query as decoded. */
export interface BrowseInput<Q> {
  readonly userId: string;
  readonly appId: string;
  readonly repo: string;
  readonly query: Q;
}

/** A read: its path segment, its query (decoded from the URL's search), deadline and answer. */
interface BrowseRead<Q extends Schema.Decoder<unknown>, E, R> {
  readonly read: string;
  readonly query: Q;
  readonly deadline: Duration.Duration;
  readonly answer: (
    input: BrowseInput<Q["Type"]>,
  ) => Effect.Effect<BrowseAnswer | BrowseBytes, E, R>;
}

/**
 * A pinned answer never changes, but who may read it does: the browser keeps it per session token
 * (`Vary: Authorization`), so another account on the same browser asks HQ, and is checked, again.
 */
const IMMUTABLE = "private, max-age=31536000, immutable";

/** A read past its deadline: read again later; slow git is no fault of HQ's to log as one. */
export class BrowseDeadline extends Schema.TaggedError<BrowseDeadline>()("BrowseDeadline", {
  read: Schema.String,
}) {}

/** FNV-1a of a read's parameters: an entity tag only tells two queries apart. */
const hashOf = (text: string) => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return (hash >>> 0).toString(16).padStart(8, "0");
};

/** A file's bytes: nothing in them runs, and a download carries the file's name. */
const bytesResponse = (
  request: { readonly headers: Readonly<Record<string, string | undefined>> },
  answer: BrowseBytes,
) => {
  const etag = `"${answer.blobSha}"`;
  const headers: Record<string, string> = {
    "cache-control": IMMUTABLE,
    etag,
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox",
    ...(answer.download === null
      ? {}
      : {
          "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(answer.download)}`,
        }),
  };
  return request.headers["if-none-match"] === etag
    ? HttpServerResponse.empty({ status: 304, headers })
    : HttpServerResponse.uint8Array(answer.bytes, {
        status: 200,
        headers,
        contentType: answer.contentType,
      });
};

/** The response an answer gets, cached or not by what it is pinned to. */
export const browseResponse = (
  request: { readonly headers: Readonly<Record<string, string | undefined>> },
  read: string,
  params: URLSearchParams,
  answer: BrowseAnswer | BrowseBytes,
) => {
  if (isBytes(answer)) return bytesResponse(request, answer);
  if (answer.pinned === null)
    return HttpServerResponse.jsonUnsafe(answer.body, {
      status: 200,
      headers: { "cache-control": "no-store" },
    });
  const canonical = new URLSearchParams(
    [...params].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  const etag = `"${read}:${answer.pinned.sha}:${hashOf(canonical.toString())}"`;
  const headers = { "cache-control": IMMUTABLE, etag, vary: "Authorization" };
  return request.headers["if-none-match"] === etag
    ? HttpServerResponse.empty({ status: 304, headers })
    : HttpServerResponse.jsonUnsafe(answer.body, { status: 200, headers });
};

const decodeRepoName = Schema.decodeUnknownEffect(RepoName);
const isBrowseRefused = Schema.is(BrowseRefused);
const refusedResponse = ({ code, limit, size }: BrowseRefused) =>
  Effect.succeed(
    HttpServerResponse.jsonUnsafe(
      {
        code,
        ...(limit === undefined ? {} : { limit }),
        ...(size === undefined ? {} : { size }),
      },
      { status: code === "too_large" ? 413 : 404 },
    ),
  );

const route = <Q extends Schema.Decoder<unknown>, E extends { readonly _tag: string }, R>(
  read: BrowseRead<Q, E, R>,
) => {
  const decodeQuery = Schema.decodeUnknownEffect(read.query);
  return HttpRouter.add(
    "GET",
    `/api/apps/:appId/repos/:repo/browse/${read.read}`,
    handle(
      Effect.gen(function* () {
        const { userId } = yield* principal;
        // The person's own bucket: signing in's, per address, stays signing in's alone.
        if (!(yield* (yield* DoorRateLimit).take(`browse ${userId}`, BROWSE_LIMIT)))
          return yield* new TooManyRequests();
        const params = yield* HttpRouter.params;
        const repo = yield* decodeRepoName(params["repo"]);
        const request = yield* HttpServerRequest.HttpServerRequest;
        const search = new URL(request.url, "http://hq").searchParams;
        const query = yield* decodeQuery(Object.fromEntries(search));
        return yield* read.answer({ userId, appId: params["appId"] ?? "", repo, query }).pipe(
          Effect.map((answer) => browseResponse(request, read.read, search, answer)),
          Effect.catch((error) =>
            isBrowseRefused(error) ? refusedResponse(error) : Effect.fail(error),
          ),
          // Interrupted at its deadline, the read's signal stops its git with it.
          Effect.timeoutOrElse({
            duration: read.deadline,
            orElse: () => Effect.fail(new BrowseDeadline({ read: read.read })),
          }),
        );
      }),
    ),
  );
};

/** One line per read. */
const BROWSE_READS = [
  route(homeRead),
  route(refsRead),
  route(logRead),
  route(treeRead),
  route(blobRead),
  route(rawRead),
  route(commitRead),
  route(commitFileRead),
  route(compareRead),
  route(compareFileRead),
  route(pathsRead),
  route(grepRead),
] as const;

/** The reads share one heavy-read allowance per HQ. */
export const gitBrowseRoutes = Layer.mergeAll(...BROWSE_READS).pipe(
  HttpRouter.provideRequest(browseHeavyLayer),
);
