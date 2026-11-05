/**
 * ZeropsAccessRead — the two Zerops reads this Mate computes its own access list from, made with
 * its project key (`ZeropsMateKey`): `GET /project/{own}` for its `userRoles` and `tagList`, and
 * `POST /client-user/search` over the project's organisation for every person with their org role
 * and status. Integration tokens are no persons: the search does not name them, and an override
 * of theirs in `userRoles` matches nobody.
 *
 * The key is a request header only: never logged, never part of an outcome.
 *
 * @module ZeropsAccessRead
 */
import {
  type ProjectRoles,
  readOrgMembers,
  readProjectRoles,
  type ZeropsOrgMember,
} from "@t3tools/shared/mateAccess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient } from "effect/http";

import type { ZeropsEnvironment } from "./ZeropsEnvironment.ts";
import { requestWithMateKey, ZeropsMateKey } from "./ZeropsMateKey.ts";
import { readJson, zeropsGet, zeropsPost } from "./zeropsApiRead.ts";

/** One search page; an organisation with more members than this fails the read. */
export const MEMBER_SEARCH_LIMIT = 200;

/** The own project as its read carries it: what the door rule needs, and the project's name. */
export interface OwnProject extends ProjectRoles {
  readonly tagList: ReadonlyArray<string>;
  readonly name?: string;
}

/** One read of both, as the access list tells the outcomes apart. */
export type AccessRead =
  | {
      readonly kind: "read";
      readonly project: OwnProject;
      readonly members: ReadonlyArray<ZeropsOrgMember>;
    }
  /**
   * Zerops refused the key for good: `401` (revoked) or `400 userNotFound|projectNotFound` (the
   * project or its key is gone, ZEROPS-064). The last list is kept as it is.
   */
  | { readonly kind: "refused"; readonly status: number }
  /** No key, no answer, or one that proves nothing: the last list is kept as it is. */
  | { readonly kind: "failed"; readonly reason: string };

/** The codes that prove the project or its key gone (ZEROPS-064). */
const GONE_CODES = new Set(["userNotFound", "projectNotFound"]);

const errorCodeOf = (body: unknown): string | undefined => {
  if (typeof body !== "object" || body === null) return undefined;
  const error = (body as Record<string, unknown>)["error"];
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as Record<string, unknown>)["code"];
  return typeof code === "string" ? code : undefined;
};

type Answer =
  | { readonly kind: "body"; readonly body: unknown }
  | Exclude<AccessRead, { readonly kind: "read" }>;

export class ZeropsAccessRead extends Context.Service<
  ZeropsAccessRead,
  {
    /** Both reads, one after the other: the project names the organisation to search. */
    readonly read: Effect.Effect<AccessRead>;
  }
>()("t3/zerops/ZeropsAccessRead") {}

const make = (environment: Pick<ZeropsEnvironment, "apiBaseUrl" | "projectId">) =>
  Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient;
    const mateKey = yield* ZeropsMateKey;

    const answer = (
      request: (token: string) => ReturnType<typeof zeropsGet>,
    ): Effect.Effect<Answer> =>
      requestWithMateKey(mateKey, request).pipe(
        Effect.flatMap(({ response }) => {
          if (response === undefined)
            return Effect.succeed<Answer>({ kind: "failed", reason: "no-key" });
          if (response.status === 200)
            return Effect.map(readJson(response), (body): Answer => ({ kind: "body", body }));
          if (response.status === 401)
            return Effect.succeed<Answer>({ kind: "refused", status: 401 });
          if (response.status !== 400)
            return Effect.succeed<Answer>({ kind: "failed", reason: `status ${response.status}` });
          return readJson(response).pipe(
            Effect.map((body): Answer => {
              const code = errorCodeOf(body);
              return code !== undefined && GONE_CODES.has(code)
                ? { kind: "refused", status: 400 }
                : { kind: "failed", reason: `status 400 ${code ?? ""}`.trim() };
            }),
          );
        }),
        Effect.catchTags({
          ZeropsApiUnavailableError: (error) =>
            Effect.succeed<Answer>({ kind: "failed", reason: error.reason }),
        }),
        Effect.provideService(HttpClient.HttpClient, httpClient),
      );

    const read = Effect.gen(function* () {
      const projectAnswer = yield* answer((token) =>
        zeropsGet({
          url: `${environment.apiBaseUrl}/project/${encodeURIComponent(environment.projectId)}`,
          token,
        }),
      );
      if (projectAnswer.kind !== "body") return projectAnswer;
      const roles = readProjectRoles(projectAnswer.body);
      if (roles === null)
        return { kind: "failed", reason: "the project read names no organisation" } as const;
      const record = projectAnswer.body as Record<string, unknown>;
      const tagList = record["tagList"];
      if (
        !Array.isArray(tagList) ||
        !tagList.every((tag): tag is string => typeof tag === "string")
      )
        return { kind: "failed", reason: "the project read carried no usable tag list" } as const;
      const name = record["name"];
      const project: OwnProject = {
        ...roles,
        tagList,
        ...(typeof name === "string" && name.trim().length > 0 ? { name: name.trim() } : {}),
      };
      const membersAnswer = yield* answer((token) =>
        zeropsPost({
          url: `${environment.apiBaseUrl}/client-user/search`,
          token,
          body: {
            search: [{ name: "clientId", operator: "eq", value: project.clientId }],
            sort: [],
            limit: MEMBER_SEARCH_LIMIT,
          },
        }),
      );
      if (membersAnswer.kind !== "body") return membersAnswer;
      const page =
        typeof membersAnswer.body === "object" && membersAnswer.body !== null
          ? (membersAnswer.body as Record<string, unknown>)
          : {};
      const items = page["items"];
      if (!Array.isArray(items))
        return { kind: "failed", reason: "the member search carried no items" } as const;
      // A truncated page is no list: whoever it leaves out would be signed out as gone.
      const totalHits = page["totalHits"];
      if (typeof totalHits === "number" && totalHits > items.length)
        return {
          kind: "failed",
          reason: "the organisation has more members than one page",
        } as const;
      return { kind: "read", project, members: readOrgMembers(items) } as const;
    });

    return ZeropsAccessRead.of({ read });
  });

export const layer = (environment: Pick<ZeropsEnvironment, "apiBaseUrl" | "projectId">) =>
  Layer.effect(ZeropsAccessRead, make(environment));
