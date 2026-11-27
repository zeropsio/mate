/**
 * A taken task's change linked to it in HQ (the engine's `TaskChangeLink`, wired in
 * `engineAdapters.ts`): `POST
 * {hqOrigin}/api/mate/tasks/:taskId/change {repo, number}` under the Mate's own key, the one
 * door HQ opens to a Mate for it. HQ answers `204` once linked (a link it holds again included) and
 * refuses a task not taken on this Mate, or a change not this Mate's own or not open.
 *
 * @module ZeropsTaskChangeLink
 */
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import type { HqTaskChangeRequest } from "@t3tools/shared/hqIntake";

import * as ServerConfig from "../config.ts";
import type { TaskChangeLinkResult } from "../engine/ports.ts";
import { ZeropsMateKey } from "./ZeropsMateKey.ts";

/** How long one link waits on HQ before it is asked again. */
const LINK_WAIT = Duration.seconds(15);

const decodeRefusal = Schema.decodeUnknownOption(Schema.Struct({ code: Schema.String }));

/** The link asked of HQ by the Mate's own key, as the engine's `TaskChangeLink` port takes it. */
export const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const mateKey = yield* ZeropsMateKey;
  const httpClient = yield* HttpClient.HttpClient;
  return {
    link: (input: {
      readonly taskId: string;
      readonly repo: string;
      readonly number: number;
    }): Effect.Effect<TaskChangeLinkResult> => {
      const { taskId, repo, number } = input;
      return Effect.gen(function* () {
        const environment = config.zerops;
        if (environment === undefined)
          return { outcome: "unreachable", why: "not a Zerops project" } as const;
        const key = yield* mateKey.read;
        if (key === undefined) return { outcome: "unreachable", why: "no Mate key" } as const;
        const request = HttpClientRequest.post(
          `${environment.hqOrigin}/api/mate/tasks/${encodeURIComponent(taskId)}/change`,
        ).pipe(
          HttpClientRequest.setHeaders({
            authorization: `Project ${key}`,
            accept: "application/json",
          }),
          HttpClientRequest.bodyJsonUnsafe({ repo, number } satisfies HqTaskChangeRequest),
        );
        return yield* httpClient.execute(request).pipe(
          Effect.flatMap((response): Effect.Effect<TaskChangeLinkResult, unknown> =>
            response.status === 204 || response.status === 200
              ? Effect.succeed({ outcome: "linked" })
              : response.status >= 500
                ? Effect.succeed({ outcome: "unreachable", why: `status ${response.status}` })
                : response.json.pipe(
                    Effect.orElseSucceed(() => null),
                    Effect.map((body): TaskChangeLinkResult => ({
                      outcome: "refused",
                      status: response.status,
                      code: Option.match(decodeRefusal(body), {
                        onNone: () => null,
                        onSome: (refusal) => refusal.code,
                      }),
                    })),
                  ),
          ),
          Effect.orElseSucceed((): TaskChangeLinkResult => ({
            outcome: "unreachable",
            why: "unreachable",
          })),
          Effect.timeoutOrElse({
            duration: LINK_WAIT,
            orElse: () =>
              Effect.succeed<TaskChangeLinkResult>({ outcome: "unreachable", why: "timed out" }),
          }),
        );
      });
    },
  };
});
