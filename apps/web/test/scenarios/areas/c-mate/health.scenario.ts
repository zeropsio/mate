import { scenarioSuite } from "../../harness/suite.ts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { type MateResourceHealth } from "@t3tools/contracts";
import { MateLinkUp } from "@t3tools/shared/mateLink";
import { createScenario } from "../../harness/scenario.ts";
import { installArea } from "./fake.ts";
import { mateChat } from "./dsl.ts";

const encode = Schema.encodeEffect(MateLinkUp);
const quiet: MateResourceHealth = {
  status: "ok",
  severity: "warning",
  resources: [],
  memory: null,
  pids: null,
  io: null,
  disk: { free: 1000, total: 5000 },
  unavailable: [],
};

describe("Approved Mate health placement", () => {
  scenarioSuite((it) => {
    it.effect(
      "Decision: notices live in the composer dock only; no Restart Mate or health on faces or overview",
      () =>
        Effect.gen(function* () {
          const s = yield* createScenario([installArea]);
          yield* s.given.project("Ada", { mate: true, app: "Shop" });
          const chat = mateChat(s);
          chat.fixture().history("Look after this Mate");
          yield* s.given.signedIn;
          yield* chat.when.open("Ada", "Look after this Mate");
          yield* chat.then.ready("Ada");
          yield* chat.then.text("Look after this Mate");
          yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
          const link = s.drivers.links.get("Ada")!;
          let revision = 0;
          const publish = (evidence: MateResourceHealth) =>
            encode({
              type: "health",
              health: {
                source: {
                  ...s.drivers.mates.get("Ada")!.attention().source,
                  revision: ++revision,
                },
                sampledAt: "2026-10-12T14:00:00Z",
                evidence,
              },
            }).pipe(Effect.flatMap(link.send));
          const states = [
            {
              resources: ["memory"],
              title: "Ada ran out of memory and the system stopped a process.",
              action: true,
              oomKilledAt: 1791817200000,
            },
            {
              resources: ["memory"],
              title: "Ada has been swapping to disk for 5 minutes — work is slow.",
              action: true,
            },
            { resources: ["disk"], title: "Ada's state disk is full.", action: true },
            {
              resources: ["io"],
              title: "Ada has been waiting on disk for 5 minutes.",
              action: false,
            },
            {
              resources: ["pids"],
              title: "Ada is near its process limit — likely leftover browsers.",
              action: false,
            },
          ] as const;
          for (const state of states) {
            yield* publish({
              ...quiet,
              status: "strained",
              resources: state.resources,
              ...("oomKilledAt" in state
                ? {
                    memory: {
                      current: 100,
                      high: null,
                      max: null,
                      events: { high: 0, oom: 1, oomKill: 1 },
                      growth: { high: 0, oom: 0, oomKill: 0 },
                      pressure: null,
                      swapCurrent: 0,
                      swapMax: null,
                      oomKilledAt: state.oomKilledAt,
                    },
                  }
                : {}),
            });
            yield* chat.then.text(state.title);
            yield* Effect.promise(async () => {
              const notices = await s.page.$$eval(
                '[data-composer-banner-anchor] [role="status"]',
                (nodes) => nodes.map((node) => node.textContent),
              );
              expect(notices.filter((text) => text?.includes(state.title))).toHaveLength(1);
              const banner = await s.page.$("[data-composer-banner-anchor]");
              const text = await banner!.evaluate((node) => node.textContent ?? "");
              expect(text.includes("Open in Zerops")).toBe(state.action);
              expect(await s.page.evaluate(() => document.body.innerText)).not.toContain(
                "Restart Mate",
              );
              const faceText = await s.page.$$eval(
                "[data-mate-face-state], [data-header-face]",
                (nodes) => nodes.map((node) => node.textContent).join(" "),
              );
              expect(faceText).not.toContain(state.title);
              // The lane may retain full-resolution frames for its authorized visual check.
              if (process.env.MATE_COMPOSER_FRAMES)
                await s.page.screenshot({
                  path: `${process.env.MATE_COMPOSER_FRAMES}/health-${"oomKilledAt" in state ? "oom" : state.resources[0]}.png`,
                });
            });
            yield* publish(quiet);
            yield* chat.then.noText(state.title);
          }
          yield* publish({ ...quiet, status: "strained", resources: ["pids"] });
          yield* chat.then.text(states[4].title);
          const overviewReader = yield* s.given.browserActor({ person: "owner" });
          yield* overviewReader.given.signedIn;
          yield* Effect.promise(async () => {
            await overviewReader.page.goto(`${s.web.origin}/zerops`);
            await overviewReader.page.waitForSelector(
              '[data-zerops-surface="project-cards"] [aria-label="Open Ada"]',
            );
            const overview = await overviewReader.page.evaluate(() => document.body.innerText);
            expect(overview).not.toContain("Restart Mate");
            for (const state of states) expect(overview).not.toContain(state.title);
          });
          yield* link.close;
          yield* chat.then.noText(states[4].title);
          yield* s.then.noExternalNetwork;
        }),
    );
  });
});
