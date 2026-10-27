// @effect-diagnostics nodeBuiltinImport:off -- disposable fixture HTTP and Chrome contexts.
import { scenarioSuite } from "../../harness/suite.ts";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import { seedCoreWorld } from "../../harness/coreSeed.ts";
import { openBrowser } from "../../harness/browser.ts";
import { startScenarioCore } from "../../harness/hqCore.ts";
import { serve } from "../../harness/http.ts";
import { personDoor, placeMate } from "../../harness/mateAccess.ts";
import { ZeropsFake } from "../../fakes/zerops.ts";
import { definePerson, projectRoles } from "../../fakes/zeropsWorld.ts";

interface StructureApp {
  readonly id: string;
  readonly name: string;
  readonly projects: ReadonlyArray<{ readonly projectId: string }>;
}

// The scenario's fixture owners are exercised directly, without rendering the Mate app.
describe("harness extension APIs", () => {
  scenarioSuite((it) => {
    it.effect(
      "several projects per application, separate applications and selected people in tabs/contexts",
      () =>
        Effect.gen(function* () {
          const fake = new ZeropsFake(seedCoreWorld(yield* Clock.currentTimeMillis, true, "ORG"));
          definePerson(fake.world, "owner", { role: "OWNER" });
          definePerson(fake.world, "dev", { role: "Developer", grants: { Ada: "BASIC_USER" } });
          definePerson(fake.world, "reader", { role: "READ_ONLY" });
          const api = yield* Effect.acquireRelease(
            Effect.promise(() => serve(fake.handle, fake.socket)),
            (api) => Effect.promise(api.close),
          );
          fake.origin = api.origin;
          const core = yield* startScenarioCore({
            baseUrl: `${api.origin}/api/rest/public`,
            world: fake.world,
          });
          // The first door keeps the organisation's key, which HQ then reads Zerops with.
          const owner = yield* personDoor(core, "owner", "hq");
          const appIds = new Map<string, string>();
          for (const name of ["Ada", "Bea", "Staging", "Production", "Cara"]) {
            fake.put("project", {
              id: name,
              name,
              clientId: "ORG",
              status: "ACTIVE",
              tags: [],
              userRoles: projectRoles(fake.world, name),
            });
          }
          const shop = yield* placeMate(core, owner, "Ada", "Shop", appIds);
          const bea = yield* placeMate(core, owner, "Bea", "Shop", appIds);
          expect(bea).toBe(shop);
          for (const [projectId, kind] of [
            ["Staging", "stage"],
            ["Production", "production"],
          ] as const) {
            const attached = yield* core.call("POST", `/api/apps/${shop}/projects`, {
              session: owner,
              body: { projectId, kind, environment: { name: projectId.toLowerCase() } },
            });
            expect(attached.status).toBe(201);
          }
          const cara = yield* placeMate(core, owner, "Cara", "Other", appIds);
          expect(appIds.size).toBe(2);
          expect(appIds.get("Shop")).toBe(shop);
          expect(cara).not.toBe(shop);
          const structure = yield* core.call("GET", "/api/structure", { session: owner });
          expect(structure.status).toBe(200);
          const apps = (structure.body as { readonly apps: ReadonlyArray<StructureApp> }).apps;
          expect(apps.map(({ name }) => name).sort()).toEqual(["Other", "Shop"]);
          expect(
            apps
              .find(({ id }) => id === shop)
              ?.projects.map(({ projectId }) => projectId)
              .sort(),
          ).toEqual(["Ada", "Bea", "Production", "Staging"]);
          expect(
            apps.find(({ id }) => id === cara)?.projects.map(({ projectId }) => projectId),
          ).toEqual(["Cara"]);
          expect(
            fake.requestsByCredential.get("hq")?.get("GET /client/ORG/user/list"),
          ).toBeGreaterThan(0);

          const dist = yield* Effect.acquireRelease(
            Effect.promise(() =>
              NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "scenario-extensions-")),
            ),
            (dist) => Effect.promise(() => NodeFSP.rm(dist, { recursive: true, force: true })),
          );
          yield* Effect.promise(() =>
            NodeFSP.writeFile(
              NodePath.join(dist, "index.html"),
              "<!doctype html><title>Fixture identities</title>",
            ),
          );
          const web = yield* Effect.acquireRelease(
            Effect.promise(() => openBrowser(dist, { "https://app.zerops.io": api.origin })),
            (web) => Effect.promise(web.close),
          );
          yield* Effect.promise(async () => {
            const reader = web.page;
            const developer = await web.newPage(await web.newContext());
            const tab = await web.newPage(reader.browserContext());
            for (const [page, person, projects] of [
              [reader, "reader", ["HQ1", "P_MATE", "Ada", "Bea", "Staging", "Production", "Cara"]],
              [developer, "dev", ["Ada"]],
              [tab, "reader", ["HQ1", "P_MATE", "Ada", "Bea", "Staging", "Production", "Cara"]],
            ] as const) {
              web.setPerson(page, `personal-${person}`);
              await page.goto(
                `https://app.zerops.io/authorize-app?${new URLSearchParams({ origin: web.origin, state: "fixture" })}`,
              );
              const token = new URLSearchParams(new URL(page.url()).hash.slice(1)).get("token");
              expect(token).toBe(`personal-${person}`);
              const observed = await page.evaluate(async (token) => {
                const call = async (path: string) =>
                  (
                    await fetch(`https://app.zerops.io/api/rest/public${path}`, {
                      headers: { authorization: `Bearer ${token}` },
                    })
                  ).json();
                return {
                  info: await call("/user/info"),
                  projects: await call("/client/ORG/project"),
                };
              }, token);
              expect(observed.info.id).toBe(person);
              expect(observed.projects.list.map((row: { id: string }) => row.id)).toEqual(projects);
              expect(
                fake.requestsByCredential.get(`personal-${person}`)?.get("GET /user/info"),
              ).toBeGreaterThan(0);
            }
            expect(reader.browserContext()).toBe(tab.browserContext());
            expect(developer.browserContext()).not.toBe(reader.browserContext());
            expect(() => web.setPerson(tab, "personal-dev")).toThrow(
              "Use a new browser context to sign in as another person",
            );
            expect(web.blocked).toEqual([]);
          });
        }),
    );
  });
});
