/**
 * The recipe store's endpoint, mocked at the protocol boundary.
 *
 * `GET /recipe-group/{groupId}` does not exist on the Zerops API yet. This
 * answers it — same base URL, same path, same JSON, same error envelope — by
 * wrapping the `fetch` the API client is given: recipe-store requests are
 * served here, everything else goes to the network untouched.
 *
 * Why a fetch wrapper rather than a mock store object: a store object makes
 * the *caller* fake. Reading a recipe would go through code that ships to
 * nobody, and the day the endpoint lands, the code that has to work is code
 * that has never run. Mocking the transport instead means
 * `readRecipeGroup` — its path, its auth header, its 404 handling — is
 * production code from the first day, and this file is the only thing that
 * gets deleted.
 *
 * It serves reads and nothing else. `POST`, `PUT`, `PATCH` and `DELETE` on the
 * route answer 405, because the real store has no write route either: zcp
 * publishes recipes from inside the project it understands, and a browser that
 * could write one could publish a recipe for a group whose services it has
 * never seen.
 *
 * It also answers 404 for a group it does not hold, which is the whole point
 * of mocking the endpoint rather than faking the data: no live group has a
 * published recipe yet, and a mock that pretended otherwise would import the
 * showcase app into somebody's environment (`hacks.md` H-26).
 *
 * @module recipeStoreMock
 */

import type { FetchImplementation } from "./api.ts";
import { RECIPE_GROUP_PATH, type ZeropsGroupRecord } from "./recipeStore.ts";
import { GO_HELLO_WORLD_GROUP } from "./recipeStoreSeed.ts";

/** The API this stands in for. A request to any other host is not ours. */
const MOCKED_ORIGIN_HOST = "api.app-prg1.zerops.io";

/** The public prefix every Zerops REST route sits under. */
const PUBLIC_API_PREFIX = "/api/rest/public";

export interface RecipeStoreMockOptions {
  /**
   * What the store holds. Defaults to the showcase group alone.
   *
   * Deliberately not "every group answers with the showcase recipe": that was
   * H-26, where "Add stage" on a live group imported `go-hello-world` instead
   * of that group's application. A group nobody has published a recipe for
   * answers 404 here exactly as the endpoint will, and the creation dialog
   * already knows what to offer instead — a sibling's export, or the agent.
   */
  readonly records?: ReadonlyArray<ZeropsGroupRecord>;
}

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

/** The platform's error envelope, which callers already know how to read. */
function apiError(code: string, message: string, status: number, headers?: Record<string, string>) {
  return json(
    { error: { code, message, meta: [{ error: message, code, metadata: null }] } },
    status,
    headers,
  );
}

/**
 * The group id this request is for, or `undefined` when the request is not for
 * this endpoint — a different host, a different route, or a path with more
 * left in it than a single id.
 */
function groupIdOf(rawUrl: string): string | undefined {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return undefined;
  }
  if (url.hostname !== MOCKED_ORIGIN_HOST) return undefined;

  const prefix = `${PUBLIC_API_PREFIX}${RECIPE_GROUP_PATH}/`;
  if (!url.pathname.startsWith(prefix)) return undefined;

  const rest = url.pathname.slice(prefix.length);
  return rest.length > 0 && !rest.includes("/") ? decodeURIComponent(rest) : undefined;
}

/**
 * Wraps a `fetch` so the recipe-store endpoint answers from `options.lookup`
 * and every other request is passed through unchanged.
 *
 * Delete this and its one call site the day `GET /recipe-group/{id}` is real.
 */
export function withRecipeStoreMock(
  fetchImplementation: FetchImplementation,
  options: RecipeStoreMockOptions = {},
): FetchImplementation {
  const records = new Map(
    (options.records ?? [GO_HELLO_WORLD_GROUP]).map((record) => [record.groupId, record]),
  );

  return (input, init) => {
    const groupId = groupIdOf(input);
    if (groupId === undefined) return fetchImplementation(input, init);

    if ((init?.method ?? "GET").toUpperCase() !== "GET") {
      return Promise.resolve(
        apiError("methodNotAllowed", "Method Not Allowed", 405, { Allow: "GET" }),
      );
    }

    const record = records.get(groupId);
    return Promise.resolve(
      record === undefined ? apiError("notFound", "Not Found", 404) : json(record, 200),
    );
  };
}
