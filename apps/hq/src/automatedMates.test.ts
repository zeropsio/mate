import { assert, describe, it } from "@effect/vitest";
import type { HqNavigationProject } from "@t3tools/shared/hqStream";
import * as Effect from "effect/Effect";

import { addProject } from "../test/harness/mates.ts";
import {
  enrollMate,
  sessionFor,
  startCore,
  ticketFor,
  untilHealth,
} from "../test/harness/runningCore.ts";
import { scopeReset, scopeValue } from "../test/harness/scopes.ts";
import { tempPostgresLayer } from "../test/harness/tempPostgres.ts";

const NAV = { kind: "navigation" } as const;

describe("automated Mates", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect(
      "an automated Mate says so in its own state and its row; an ordinary one says nothing of it",
      () =>
        Effect.gen(function* () {
          const { call, fake, socket } = yield* startCore(true);
          yield* untilHealth(call, "active");
          const owner = yield* sessionFor(call, "door-owner");
          addProject(fake, "P_ROBOT");
          for (const [projectId, automated] of [
            ["P_MATE", undefined],
            ["P_ROBOT", true],
          ] as const) {
            const made = yield* call("POST", "/api/mates", {
              session: owner,
              body: { projectId, face: "face-1", ...(automated ? { automated } : {}) },
            });
            assert.strictEqual(made.status, 201);
          }
          const selfOf = (projectId: string) =>
            Effect.gen(function* () {
              const credential = yield* enrollMate(call, fake, projectId);
              const self = yield* call("GET", "/api/mate/self", {
                headers: { authorization: `Mate ${credential}` },
              });
              return self.body as { readonly automated?: boolean };
            });
          assert.notProperty(yield* selfOf("P_MATE"), "automated");
          assert.isTrue((yield* selfOf("P_ROBOT")).automated);

          const watching = yield* socket(
            `/api/structure/ws?ticket=${yield* ticketFor(call, owner)}`,
          );
          const values = yield* scopeReset(watching, NAV);
          const robot = scopeValue<HqNavigationProject>(values, "project:P_ROBOT").mate!;
          assert.isTrue(robot.automated);
          assert.isNull(robot.task);
          const ordinary = scopeValue<HqNavigationProject>(values, "project:P_MATE").mate!;
          assert.notProperty(ordinary, "automated");
          assert.notProperty(ordinary, "task");
          yield* watching.close;
        }),
    );

    it.effect("a Mate born automated into an application is automated once it attaches", () =>
      Effect.gen(function* () {
        const { call, fake } = yield* startCore(true);
        yield* untilHealth(call, "active");
        const owner = yield* sessionFor(call, "door-owner");
        const app = yield* call("POST", "/api/apps", { session: owner, body: { name: "Shop" } });
        const appId = (app.body as { readonly id: string }).id;
        const birth = yield* call("POST", "/api/births", {
          session: owner,
          body: { appId, face: "face-1", automated: true },
        });
        assert.strictEqual(birth.status, 201);
        const attached = yield* call("POST", `/api/apps/${appId}/projects`, {
          session: owner,
          body: {
            projectId: "P_MATE",
            kind: "mate",
            mate: { face: "face-1" },
            birth: (birth.body as { readonly id: string }).id,
          },
        });
        assert.strictEqual(attached.status, 201);
        const credential = yield* enrollMate(call, fake, "P_MATE");
        const self = yield* call("GET", "/api/mate/self", {
          headers: { authorization: `Mate ${credential}` },
        });
        assert.isTrue((self.body as { readonly automated?: boolean }).automated);
      }),
    );
  });
});
