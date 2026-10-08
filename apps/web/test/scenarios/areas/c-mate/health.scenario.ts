import { describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { MateHealth } from "@t3tools/contracts";
import { MateLinkUp } from "@t3tools/shared/mateLink";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { createScenario } from "../../harness/scenario.ts";
import { installArea } from "./fake.ts";
import { mateChat } from "./dsl.ts";

const encode = Schema.encodeSync(MateLinkUp);
describe("C: measured health above the composer", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect(
      "The composer presents the owner's health verdict until the owner reports recovery",
      () =>
        Effect.gen(function* () {
          const s = yield* createScenario([installArea]);
          yield* s.given.project("Toby", { mate: true });
          const mate = s.drivers.mates.get("Toby")!;
          const chat = mateChat(s);
          chat.fixture("Toby").history();
          const health: MateHealth = {
            source: {
              environmentId: mate.descriptor.environmentId,
              epoch: 1,
              incarnation: "health",
              revision: 1,
            },
            sampledAt: "2026-10-08T12:00:00Z",
            evidence: {
              status: "strained",
              severity: "warning",
              resources: ["memory"],
              memory: {
                current: 3 * 1024 ** 3,
                high: 2 * 1024 ** 3,
                max: 4 * 1024 ** 3,
                events: { high: 100, oom: 0, oomKill: 0 },
                growth: { high: 1, oom: 0, oomKill: 0 },
                swapCurrent: 1024,
                swapMax: 2048,
                swapGrowth: 512,
                pressure: { some: { avg10: 5, total: 300 }, full: null },
              },
              cpu: null,
              io: null,
              disk: { free: 1000, total: 2000 },
              unavailable: [],
            },
          };
          yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
          yield* s.given.signedIn;
          yield* chat.when.open("Toby");
          yield* Effect.promise(() =>
            s.page.waitForFunction(() => {
              const stage = document.querySelector("[data-conversation-opening]");
              return stage === null || getComputedStyle(stage).visibility === "hidden";
            }),
          );
          const sustained: MateHealth = {
            ...health,
            source: { ...health.source, revision: 2 },
            evidence: {
              ...health.evidence,
              memory: {
                ...health.evidence.memory!,
                pressure: {
                  some: { avg10: 5, total: 300 },
                  full: { avg10: 0, avg60: 10, avg300: 10, total: 200 },
                },
              },
            },
          };
          const link = s.drivers.links.get("Toby")!;
          yield* link.send(encode({ type: "health", health: sustained }));
          yield* chat.then.once("Toby is short of memory — work may be slow");
          yield* link.send(
            encode({
              type: "health",
              health: { ...health, source: { ...health.source, revision: 3 } },
            }),
          );
          yield* chat.then.once("Toby is short of memory — work may be slow");
          yield* chat.then.noText("under memory pressure");
          yield* chat.then.ready("Toby");
          yield* link.send(
            encode({
              type: "health",
              health: { ...sustained, source: { ...health.source, revision: 4 } },
            }),
          );
          yield* chat.then.once("Toby is short of memory — work may be slow");
          yield* chat.then.once(
            "Close idle terminal agents or the IDE in the container, or raise the RAM limit in Zerops.",
          );
          yield* chat.then.noText("capped at");
          yield* chat.then.ready("Toby");
          yield* link.send(
            encode({
              type: "health",
              health: {
                ...sustained,
                source: { ...health.source, revision: 5 },
                evidence: { ...sustained.evidence, status: "ok", resources: [] },
              },
            }),
          );
          yield* chat.then.noText("short of memory");
          yield* chat.then.ready("Toby");
          yield* s.then.noExternalNetwork;
        }),
    );
  });
});
