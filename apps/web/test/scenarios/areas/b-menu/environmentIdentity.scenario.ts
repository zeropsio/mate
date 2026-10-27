import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import {
  environmentIdentityWire,
  type EnvironmentWire,
} from "../../fakes/b-menu/environmentIdentity.ts";
import { environmentFixtureWith } from "../e-env/fake.ts";
import { environmentActions } from "../e-env/dsl.ts";
import { environmentRows, openEnvironment, menuScenario } from "./dsl.ts";

const encodeReceipt = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeService = Schema.decodeUnknownSync(
  Schema.Struct({ activeAppVersion: Schema.Struct({ id: Schema.String }) }),
);

// The compatibility matrix runs these same real consumers with immutable historical browser bundles.
const compatibility = Effect.fn("environment.compatibility")(function* (
  mode: EnvironmentWire | "current",
) {
  const f = yield* environmentFixtureWith({ signIn: "ui" });
  const frames: string[] = [];
  const wire = mode === "current" ? undefined : environmentIdentityWire(mode);
  f.s.drivers.hq.mapFrames((frame) => {
    frames.push(frame);
    return wire?.map(frame) ?? frame;
  });
  const assertCurrentFrames = () => {
    const environments: Record<string, unknown>[] = [];
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(visit);
      } else if (value !== null && typeof value === "object") {
        const record = value as Record<string, unknown>;
        if (
          (record.tier === "stage" || record.tier === "production") &&
          Array.isArray(record.sources)
        ) {
          environments.push(record);
        }
        Object.values(record).forEach(visit);
      }
    };
    frames.forEach((frame) => visit(JSON.parse(frame)));
    expect(environments.length).toBeGreaterThan(0);
    for (const environment of environments) {
      expect(Object.hasOwn(environment, "projectId")).toBe(false);
      expect(environment.target).toEqual({ kind: "zerops", projectId: environment.id });
    }
  };
  const a = environmentActions(f);
  yield* f.s.given.signedIn;
  yield* a.when.openFromNavigation;
  yield* Effect.promise(() =>
    f.s.page.waitForFunction(
      (path) => location.pathname === path,
      {},
      `/group/${f.appId}/Shop-production`,
    ),
  );
  expect(new URL(f.s.page.url()).pathname).toBe(`/group/${f.appId}/Shop-production`);
  yield* Effect.promise(() => f.s.page.goto(`${f.s.web.origin}/group/${f.appId}/flow`));
  // The project page draws production first, then its stages.
  const rows = [
    { name: "Shop-production", id: "Shop-production" },
    { name: "Shop-stage", id: "Shop-stage" },
  ];
  yield* environmentRows(
    f.s.page,
    rows.map((row) => row.name),
  );
  if (mode === "current") assertCurrentFrames();
  // Jobs and service evidence arrive after first paint, through the actual Core and platform.
  const sha = yield* f.merge();
  yield* a.when.finish("stage");
  yield* environmentRows(
    f.s.page,
    rows.map((row) => row.name),
  );
  yield* openEnvironment(f.s.page, f.appId, "Shop-stage", "Shop-stage");
  expect(new URL(f.s.page.url()).pathname).toBe(`/group/${f.appId}/Shop-stage`);
  yield* a.then.text(sha.slice(0, 7));
  yield* a.then.text("web");
  yield* Effect.promise(() => f.s.page.reload());
  yield* a.then.text(sha.slice(0, 7));
  expect(new URL(f.s.page.url()).pathname).toBe(`/group/${f.appId}/Shop-stage`);
  expect(f.s.drivers.zerops.requests.get("GET /project/Shop-stage")).toBeGreaterThan(0);
  const service = decodeService(
    f.s.drivers.zerops.rows("service-stack").find((row) => row.id === "web-stage"),
  );
  expect(f.s.drivers.zerops.world.appVersions.get(service.activeAppVersion.id)).toMatchObject({
    serviceId: "web-stage",
    name: `main ${sha.slice(0, 7)}`,
  });
  const structure = (yield* f.s.drivers.core.call("GET", "/api/structure", {
    session: f.s.drivers.owner,
  })).body as {
    apps: {
      id: string;
      environments: {
        id: string;
        target: { kind: "zerops"; projectId: string };
        jobs: { sha: string; service: string; state: string }[];
      }[];
    }[];
  };
  expect(
    structure.apps
      .find((app) => app.id === f.appId)
      ?.environments.find((environment) => environment.target.projectId === "Shop-stage")?.jobs[0],
  ).toMatchObject({ sha, service: "web", state: "live" });
  yield* Effect.logInfo(
    "environment compatibility values",
    encodeReceipt({
      mode,
      environments: structure.apps
        .find((app) => app.id === f.appId)
        ?.environments.map((environment) => ({
          projectId: environment.target.projectId,
          jobs: environment.jobs.map(({ sha, service, state }) => ({ sha, service, state })),
        })),
      selectedPath: new URL(f.s.page.url()).pathname,
      projectReads: f.s.drivers.zerops.requests.get("GET /project/Shop-stage"),
      service: {
        id: "web-stage",
        activeVersion: service.activeAppVersion.id,
        name: f.s.drivers.zerops.world.appVersions.get(service.activeAppVersion.id)?.name,
      },
    }),
  );
  if (mode === "current") {
    yield* f.s.when.hq.socket.drops;
    yield* f.s.then.hq.isUnavailable;
    yield* f.s.when.hq.socket.returns;
    yield* Effect.promise(() =>
      f.s.page.waitForSelector('[data-zerops-surface="sidebar-hq-outage"]', {
        hidden: true,
      }),
    );
    yield* a.then.text(sha.slice(0, 7));
    expect(new URL(f.s.page.url()).pathname).toBe(`/group/${f.appId}/Shop-stage`);
    assertCurrentFrames();
  }
  yield* f.s.then.noExternalNetwork;
});

describe("B: environment identity compatibility", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect(
      "Current HQ omits redundant environment identity while navigation, late jobs, reload and recovery retain their values.",
      () => compatibility("current"),
    );
    it.effect("Old HQ and new hosted web keep sign-in and environment navigation working.", () =>
      compatibility("legacy"),
    );
    it.effect(
      "Old clients keep their Zerops environments after HQ gains environment identities.",
      () => compatibility("modern"),
    );

    it.effect("A partial modern environment is refused without erasing known environments.", () =>
      Effect.gen(function* () {
        const s = yield* menuScenario();
        const wire = environmentIdentityWire("modern");
        wire.install(s.drivers);
        yield* s.given.project("Ada", { mate: true, app: "Shop" });
        yield* s.stage("preview", "Shop");
        yield* s.given.signedIn;
        yield* s.menu.opensApplication("Shop");
        const appId = s.appIds.get("Shop")!;
        const rows = [{ name: "preview", id: "preview" }];
        yield* environmentRows(
          s.page,
          rows.map((row) => row.name),
        );
        wire.set("partial");
        // A resumed cursor does not resend unchanged facts; a real Core revision carries the new wire input.
        yield* s.when.hq.colleague.renamesProject("Shop", "Shop partial");
        yield* Effect.promise(() =>
          s.page.waitForFunction(
            () => document.querySelector("h1")?.textContent === "Shop partial",
            {
              polling: "raf",
            },
          ),
        );
        yield* environmentRows(
          s.page,
          rows.map((row) => row.name),
        );
        wire.set("modern");
        yield* s.when.hq.colleague.renamesProject("Shop", "Shop");
        yield* Effect.promise(() =>
          s.page.waitForFunction(() => document.querySelector("h1")?.textContent === "Shop", {
            polling: "raf",
          }),
        );
        yield* s.when.hq.socket.drops;
        yield* s.then.hq.isUnavailable;
        yield* s.when.hq.socket.returns;
        yield* Effect.promise(() =>
          s.page.waitForSelector('[data-zerops-surface="sidebar-hq-outage"]', {
            hidden: true,
          }),
        );
        yield* environmentRows(
          s.page,
          rows.map((row) => row.name),
        );
        yield* openEnvironment(s.page, appId, "preview", "preview");
        yield* Effect.promise(() =>
          s.page.waitForFunction(
            () => document.querySelector("main")?.innerText.includes("stage-existing"),
            { polling: "raf" },
          ),
        );
        yield* s.then.noExternalNetwork;
      }),
    );

    it.effect(
      "Environment routes dispatch mixed targets without using their ids as projects.",
      () =>
        Effect.gen(function* () {
          const f = yield* environmentFixtureWith();
          const wire = environmentIdentityWire("modern", {
            "Shop-stage": {
              id: "independent-preview",
              target: { kind: "zerops", projectId: "Shop-stage" },
            },
            "Shop-production": {
              id: "git-production",
              target: { kind: "git", branch: "release", delivery: "direct" },
            },
          });
          wire.install(f.s.drivers);
          const a = environmentActions(f);
          yield* f.s.given.signedIn;
          yield* Effect.promise(() => f.s.page.goto(`${f.s.web.origin}/group/${f.appId}/flow`));
          yield* environmentRows(f.s.page, ["production", "Shop-stage"]);
          yield* openEnvironment(f.s.page, f.appId, "Shop-stage", "independent-preview");
          yield* a.then.text("web");
          const sha = yield* f.merge();
          yield* a.when.finish("stage");
          yield* a.then.text(sha.slice(0, 7));
          yield* a.then.text("Deployed");
          expect(new URL(f.s.page.url()).pathname).toBe(`/group/${f.appId}/independent-preview`);
          expect(f.s.drivers.zerops.requests.get("GET /project/Shop-stage")).toBeGreaterThan(0);
          yield* Effect.promise(() => f.s.page.goto(`${f.s.web.origin}/group/${f.appId}/flow`));
          yield* environmentRows(f.s.page, ["production", "Shop-stage"]);
          yield* openEnvironment(f.s.page, f.appId, "production", "git-production");
          yield* Effect.promise(() =>
            f.s.page.waitForFunction(
              () => document.querySelector("h1")?.textContent === "production",
              { polling: "raf" },
            ),
          );
          for (const id of ["independent-preview", "git-production"]) {
            expect(f.s.drivers.zerops.requests.get(`GET /project/${id}`) ?? 0).toBe(0);
          }
          yield* f.s.then.noExternalNetwork;
        }),
    );

    it.effect(
      "Unknown, refused and unavailable environment routes never read a project by environment id.",
      () =>
        Effect.gen(function* () {
          const wire = environmentIdentityWire("modern");
          const s = yield* menuScenario([wire.install]);
          yield* s.given.project("Ada", { mate: true, app: "Shop" });
          yield* s.stage("preview", "Shop");
          yield* s.given.signedIn;
          const appId = s.appIds.get("Shop")!;
          yield* Effect.promise(() =>
            s.page.goto(`${s.web.origin}/group/${appId}/unknown-environment`),
          );
          yield* Effect.promise(() =>
            s.page.waitForFunction(
              // The page stands in shaped like its cards while the project is read.
              () => document.querySelector('main [data-slot="loading"][aria-busy="true"]') !== null,
              { polling: "raf" },
            ),
          );
          wire.set("refused");
          yield* s.when.hq.colleague.renamesProject("Shop", "Shop refused");
          // The refused name is the receipt that the revision reached the tab: a resumed cursor sends
          // only what differs from the last frame, so renaming back counts only from this name.
          yield* Effect.promise(() =>
            s.page.waitForFunction(
              () =>
                document.body.innerText.includes("Shop refused") &&
                document.querySelector("main")?.textContent?.includes("identity fixture refused"),
              { polling: "raf" },
            ),
          );
          wire.set("modern");
          yield* s.when.hq.socket.drops;
          yield* s.then.hq.isUnavailable;
          expect(s.drivers.zerops.requests.get("GET /project/unknown-environment") ?? 0).toBe(0);
          yield* s.when.hq.socket.returns;
          yield* s.when.hq.colleague.renamesProject("Shop", "Shop");
          yield* s.menu.opensApplication("Shop");
          yield* environmentRows(s.page, ["preview"]);
          yield* openEnvironment(s.page, appId, "preview", "preview");
          yield* Effect.promise(() =>
            s.page.waitForFunction(
              () => document.querySelector("main")?.innerText.includes("stage-existing"),
              { polling: "raf" },
            ),
          );
          expect(s.drivers.zerops.requests.get("GET /project/unknown-environment") ?? 0).toBe(0);
          yield* s.then.noExternalNetwork;
        }),
    );

    it.effect(
      "An environment arriving after first paint appears once with its target's service version.",
      () =>
        Effect.gen(function* () {
          const s = yield* menuScenario();
          yield* s.given.project("Ada", { mate: true, app: "Shop" });
          yield* s.given.signedIn;
          yield* s.menu.opensApplication("Shop");
          yield* environmentRows(s.page, []);
          yield* s.stage("preview", "Shop");
          yield* environmentRows(s.page, ["preview"]);
          yield* openEnvironment(s.page, s.appIds.get("Shop")!, "preview", "preview");
          yield* Effect.promise(() =>
            s.page.waitForFunction(
              () => document.querySelector("main")?.innerText.includes("stage-existing"),
              { polling: "raf" },
            ),
          );
          expect(s.drivers.zerops.world.appVersions.get("version-preview")).toMatchObject({
            serviceId: "app-preview",
            name: "stage-existing",
          });
          yield* s.then.noExternalNetwork;
        }),
    );
  });
});
