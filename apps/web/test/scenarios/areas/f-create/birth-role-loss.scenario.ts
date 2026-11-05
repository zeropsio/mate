import { describe, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { definePerson } from "../../fakes/zeropsWorld.ts";
import { completedHttp } from "../../harness/completedHttp.ts";
import { createScenario } from "../../harness/scenario.ts";
import { scenarioSuite } from "../../harness/suite.ts";
import { receipt } from "./dsl.ts";
import { installCreation } from "./fake.ts";

describe("a stopped shared Mate birth", () => {
  scenarioSuite((it) => {
    it.effect(
      "a person who lost the role mid-birth sees the stopped state and no Continue",
      () =>
        Effect.gen(function* () {
          const s = yield* createScenario([installCreation]);
          yield* s.given.project("Ada", { mate: true, app: "Shop" });
          const id = "4fc36bc9-bafb-4430-bc33-ecf0c79505c6";
          const born = yield* s.drivers.core.call("POST", "/api/births", {
            session: s.owner,
            body: {
              id,
              appId: s.appIds.get("Shop"),
              face: "rose:seal",
              intent: {
                projectName: "Shop - Nova",
                recipe: { kind: "none" },
                agents: ["codex"],
                standUp: false,
                automated: false,
                placement: { role: "dev", name: "Nova", chief: false },
                location: null,
                userRoles: [],
              },
            },
          });
          expect(born.status).toBe(201);
          const claimed = yield* s.drivers.core.call("PUT", `/api/births/${id}/attempt`, {
            session: s.owner,
            body: { step: "create" },
          });
          expect(claimed.status).toBe(200);
          const refused = yield* s.drivers.core.call("PUT", `/api/births/${id}/attempt`, {
            session: s.owner,
            body: {
              step: "create",
              outcome: "refused",
              reason: "Creation refused by Zerops.",
              at: (claimed.body as { at: string }).at,
            },
          });
          expect(refused.status).toBe(200);
          yield* s.given.signedIn;
          yield* Effect.promise(async () => {
            await s.page.goto(`${s.web.origin}/mate/new/${id}`);
            await receipt(
              s.page.waitForFunction(
                () =>
                  document
                    .querySelector('[data-zerops-surface="mate-empty-state"]')
                    ?.textContent?.includes("Creation refused by Zerops."),
                { polling: "raf" },
              ),
              "stopped birth with its recorded refusal",
            );
            await receipt(
              s.page.locator("::-p-aria(Continue)").wait(),
              "Continue before role loss",
            );
            await receipt(
              s.drivers.zerops.waitForRegistration("client-user", "updateStream"),
              "membership update stream registered",
            );
            const frames = s.drivers.zerops.framesByKind.get("client-user:updateStream") ?? 0;
            const refreshed = s.page.waitForResponse(
              (response) =>
                response.request().method() === "GET" &&
                new URL(response.url()).pathname === "/api/rest/public/user/info",
            );
            const settled = completedHttp(s.page);
            try {
              definePerson(s.drivers.zerops.world, "owner", { role: "READ_ONLY" });
              s.drivers.zerops.put("client-user", {
                id: "C-owner",
                clientId: "ORG",
                userId: "owner",
                roleCode: "READ_ONLY",
                status: "ACTIVE",
              });
              expect(s.drivers.zerops.framesByKind.get("client-user:updateStream")).toBeGreaterThan(
                frames,
              );
              const response = await receipt(
                refreshed,
                "viewer membership refreshed after role loss",
              );
              expect(response.status()).toBe(200);
              const info = (await response.json()) as {
                clientUserList: { clientId: string; roleCode: string }[];
              };
              expect(
                info.clientUserList.some(
                  (member) => member.clientId === "ORG" && member.roleCode === "READ_ONLY",
                ),
              ).toBe(true);
              await receipt(settled(), "role-loss reads and rendering settled");
              const state = await s.page.evaluate(() => {
                const surface = document.querySelector('[data-zerops-surface="mate-empty-state"]');
                return {
                  reason: surface?.textContent?.includes("Creation refused by Zerops.") ?? false,
                  guidance:
                    surface?.textContent?.includes(
                      "The person who started this setup can continue if they can add Mates and attach the project.",
                    ) ?? false,
                  continues: [...(surface?.querySelectorAll("button") ?? [])].filter(
                    (button) => button.textContent?.trim() === "Continue",
                  ).length,
                };
              });
              expect(state).toEqual({ reason: true, guidance: true, continues: 0 });
            } finally {
              settled.close();
            }
          });
          yield* s.then.noExternalNetwork;
        }),
      60_000,
    );
  });
});
