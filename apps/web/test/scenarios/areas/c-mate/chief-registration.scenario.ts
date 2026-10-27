import { scenarioSuite } from "../../harness/suite.ts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { createScenario } from "../../harness/scenario.ts";
import { mateChat } from "./dsl.ts";
import { ownerMenu } from "./ownerReportedLayout.ts";

const REGISTER = '::-p-aria([name="Make this my Chief"][role="button"])';

describe("Chief registration", () => {
  scenarioSuite((it) => {
    it.effect("a person registers a tagged Chief from its page and opens its conversation", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([], { mate: "real" });
        yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
        yield* s.given.project("Chief", { mate: true });
        const { zerops } = s.drivers;
        zerops.put("project", {
          ...zerops.rows("project").find((project) => project.id === "Chief")!,
          tagList: ["chief"],
        });
        yield* s.given.signedIn;
        const chat = mateChat(s);
        yield* chat.when.visit("/mate/Chief");
        const registered = yield* Effect.promise(async () => {
          await s.page.waitForSelector(REGISTER, { visible: true });
          expect(
            await s.page.$('[data-zerops-surface="sidebar-chief-row"]'),
            "ASSERTION: a tag alone does not register the person's Chief",
          ).toBeNull();
          await ownerMenu(s.page);
          if (process.env.CHIEF_REGISTRATION_EVIDENCE) {
            await s.page.screenshot({ path: process.env.CHIEF_REGISTRATION_EVIDENCE });
          }
          const response = s.page.waitForResponse(
            (response) =>
              response.request().method() === "PUT" &&
              new URL(response.url()).pathname.endsWith("/api/chief"),
          );
          await s.page.locator(REGISTER).click();
          const answer = await response;
          return answer;
        });
        expect(registered.status(), "ASSERTION: HQ accepts the Chief registration").toBe(200);
        expect(
          yield* Effect.promise(() => registered.json()),
          "ASSERTION: the web control registers this exact project through HQ",
        ).toMatchObject({ chief: { projectId: "Chief" } });
        yield* chat.then.ready("Chief");
        yield* Effect.promise(() =>
          s.page.waitForSelector('[data-zerops-surface="sidebar-chief-row"]', { visible: true }),
        );
        yield* Effect.promise(async () => {
          expect(
            await s.page.$(REGISTER),
            "ASSERTION: a registered Chief has no registration control",
          ).toBeNull();
          expect(
            new URL(s.page.url()).pathname,
            "ASSERTION: registration opens the Chief's draft conversation",
          ).toMatch(/^\/draft\/[^/]+$/);
          expect(await s.page.$eval('[role="textbox"]', (element) => element.textContent)).toBe("");
        });
        yield* s.then.noExternalNetwork;
      }),
    );
  });
});
