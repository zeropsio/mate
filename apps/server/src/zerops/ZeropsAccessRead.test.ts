import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient, HttpClientResponse } from "effect/http";

import * as ZeropsAccessReadModule from "./ZeropsAccessRead.ts";
import { ownAccessList, ticketVerdict } from "./ZeropsMateAccessList.ts";
import * as ZeropsMateKeyModule from "./ZeropsMateKey.ts";

const PROJECT_ID = "P_MATE";
const ORG = "ORG_1";

interface Sent {
  readonly line: string;
  readonly authorization: string | undefined;
  readonly body: unknown;
}

/** A platform answering each path as `answers` says; every request it saw, in order. */
const platform = (answers: {
  readonly project: () => Response;
  readonly search?: () => Response;
}) => {
  const sent: Array<Sent> = [];
  const layer = ZeropsAccessReadModule.layer({
    apiBaseUrl: "https://zerops.test",
    projectId: PROJECT_ID,
  }).pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(
          HttpClient.HttpClient,
          HttpClient.make((request) =>
            Effect.gen(function* () {
              const body =
                request.body._tag === "Uint8Array"
                  ? JSON.parse(new TextDecoder().decode(request.body.body))
                  : undefined;
              const path = request.url.replace("https://zerops.test", "");
              sent.push({
                line: `${request.method} ${path}`,
                authorization: request.headers["authorization"],
                body,
              });
              const answer =
                path === `/project/${PROJECT_ID}` ? answers.project() : answers.search!();
              return HttpClientResponse.fromWeb(request, answer);
            }),
          ),
        ),
        Layer.succeed(
          ZeropsMateKeyModule.ZeropsMateKey,
          ZeropsMateKeyModule.snapshotOnlyReader("project-key"),
        ),
      ),
    ),
  );
  return { layer, sent };
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const readOnce = Effect.gen(function* () {
  return yield* (yield* ZeropsAccessReadModule.ZeropsAccessRead).read;
});

describe("ZeropsAccessRead", () => {
  // The Mate admits only the owner HQ names (its registered person); HQ's own ticket check admits only the registered person too.
  it.effect(
    "a project tagged chief admits only its owner, whatever role another member holds",
    () => {
      const zerops = platform({
        project: () =>
          json(200, {
            id: PROJECT_ID,
            clientId: ORG,
            tagList: ["mate", "chief"],
            userRoles: [{ clientUserId: "cu-owner", roleCode: "OWNER" }],
          }),
        search: () =>
          json(200, {
            items: [
              { id: "cu-owner", userId: "owner", roleCode: "NO_ACCESS", status: "ACTIVE" },
              { id: "cu-admin", userId: "admin", roleCode: "ADMIN", status: "ACTIVE" },
              { id: "cu-org-owner", userId: "org-owner", roleCode: "OWNER", status: "ACTIVE" },
              { id: "cu-basic", userId: "basic", roleCode: "BASIC_USER", status: "ACTIVE" },
              { id: "cu-reader", userId: "reader", roleCode: "READ_ONLY", status: "ACTIVE" },
            ],
          }),
      });
      return Effect.gen(function* () {
        const outcome = yield* readOnce;
        if (outcome.kind !== "read") return assert.fail(`read failed: ${outcome.kind}`);
        const list = ownAccessList(PROJECT_ID, outcome, 0, "owner");
        assert.deepStrictEqual(list.members, [
          { userId: "owner", role: "OWNER", visibility: "open" },
        ]);
        assert.strictEqual(ticketVerdict(list, "owner", 0), "open");
        for (const userId of ["admin", "org-owner", "basic", "reader"]) {
          assert.strictEqual(ticketVerdict(list, userId, 0), "not_in_list");
        }
      }).pipe(Effect.provide(zerops.layer));
    },
  );

  it.effect.each([undefined, null, ["mate", null]])(
    "A project read without a usable tag list fails instead of treating an unknown Chief as ordinary: %s",
    (tagList) => {
      const zerops = platform({
        project: () => json(200, { clientId: ORG, userRoles: [], tagList }),
        search: () => json(200, { items: [] }),
      });
      return Effect.gen(function* () {
        assert.strictEqual((yield* readOnce).kind, "failed");
      }).pipe(Effect.provide(zerops.layer));
    },
  );

  it.effect(
    "The Mate server computes its own access list from the container's project key: GET /project/{own} for userRoles, then POST /client-user/search over its organisation",
    () => {
      const zerops = platform({
        project: () =>
          json(200, {
            id: PROJECT_ID,
            clientId: ORG,
            tagList: [],
            userRoles: [{ clientUserId: "cu-nia", roleCode: "BASIC_USER" }],
          }),
        search: () =>
          json(200, {
            items: [
              { id: "cu-jan", userId: "jan", roleCode: "OWNER", status: "ACTIVE" },
              { id: "cu-nia", userId: "nia", roleCode: "NO_ACCESS", status: "ACTIVE" },
            ],
          }),
      });
      return Effect.gen(function* () {
        const outcome = yield* readOnce;
        assert.deepStrictEqual(zerops.sent, [
          {
            line: `GET /project/${PROJECT_ID}`,
            authorization: "Bearer project-key",
            body: undefined,
          },
          {
            line: "POST /client-user/search",
            authorization: "Bearer project-key",
            body: {
              search: [{ name: "clientId", operator: "eq", value: ORG }],
              sort: [],
              limit: 200,
            },
          },
        ]);
        assert.deepStrictEqual(outcome, {
          kind: "read",
          project: { clientId: ORG, overrides: { "cu-nia": "BASIC_USER" }, tagList: [] },
          members: [
            {
              clientUserId: "cu-jan",
              userId: "jan",
              orgRole: "OWNER",
              status: "ACTIVE",
              canCreateProjects: false,
            },
            {
              clientUserId: "cu-nia",
              userId: "nia",
              orgRole: "NO_ACCESS",
              status: "ACTIVE",
              canCreateProjects: false,
            },
          ],
        });
        // The key is a request header only: no outcome carries it.
        assert.notInclude(JSON.stringify(outcome), "project-key");
      }).pipe(Effect.provide(zerops.layer));
    },
  );

  it.effect(
    "A member search that names fewer persons than the organisation holds fails the read, so nobody past its page is taken for gone",
    () => {
      const zerops = platform({
        project: () => json(200, { clientId: ORG, userRoles: [], tagList: [] }),
        search: () =>
          json(200, {
            totalHits: 201,
            items: [{ id: "cu-jan", userId: "jan", roleCode: "OWNER", status: "ACTIVE" }],
          }),
      });
      return Effect.gen(function* () {
        assert.strictEqual((yield* readOnce).kind, "failed");
      }).pipe(Effect.provide(zerops.layer));
    },
  );

  it.effect.each([
    {
      name: "401 on the project read",
      project: () => json(401, {}),
      search: undefined,
      kind: "refused",
    },
    {
      name: "400 projectNotFound",
      project: () => json(400, { error: { code: "projectNotFound" } }),
      search: undefined,
      kind: "refused",
    },
    {
      name: "400 userNotFound on the search",
      project: () => json(200, { clientId: ORG, userRoles: [], tagList: [] }),
      search: () => json(400, { error: { code: "userNotFound" } }),
      kind: "refused",
    },
    {
      name: "another 400",
      project: () => json(400, { error: { code: "invalidUserInput" } }),
      search: undefined,
      kind: "failed",
    },
    { name: "a 5xx", project: () => json(503, {}), search: undefined, kind: "failed" },
    { name: "a 403", project: () => json(403, {}), search: undefined, kind: "failed" },
  ])(
    "Zerops 401 or 400 userNotFound|projectNotFound refuses the read for good; anything else only fails it: $name",
    ({ project, search, kind }) => {
      const zerops = platform({
        project,
        ...(search === undefined ? {} : { search }),
      });
      return Effect.gen(function* () {
        assert.strictEqual((yield* readOnce).kind, kind);
      }).pipe(Effect.provide(zerops.layer));
    },
  );

  // witness: apps/server/src/zerops/ZeropsAccessRead.ts | if (status !== 400 && status !== 404) → if (status !== 400)
  it.effect.each([
    {
      name: "404 projectNotFound",
      project: () => json(404, { error: { code: "projectNotFound" } }),
      search: undefined,
      kind: "refused",
    },
    {
      name: "404 userNotFound on the search",
      project: () => json(200, { clientId: ORG, userRoles: [], tagList: [] }),
      search: () => json(404, { error: { code: "userNotFound" } }),
      kind: "refused",
    },
    {
      name: "a route-level 404",
      project: () => json(404, { error: { code: "notFound" } }),
      search: undefined,
      kind: "failed",
    },
  ])(
    "Zerops userNotFound|projectNotFound at 404 refuses the read for good, as at 400; another 404 only fails it: $name",
    ({ project, search, kind }) => {
      const zerops = platform({
        project,
        ...(search === undefined ? {} : { search }),
      });
      return Effect.gen(function* () {
        assert.strictEqual((yield* readOnce).kind, kind);
      }).pipe(Effect.provide(zerops.layer));
    },
  );
});
