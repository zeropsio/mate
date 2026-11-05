import { describe, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { deadline } from "../../harness/http.ts";
import { createScenario } from "../../harness/scenario.ts";
import { scenarioSuite } from "../../harness/suite.ts";
import { mateChat } from "./dsl.ts";
import { installArea, projectGrant } from "./fake.ts";

describe("a project grant returns while its conversation is open", () => {
  scenarioSuite((it) => {
    it.effect(
      "Decision: When a project leaves the person's live `project` stream, an open conversation on it shows the honest closed state (as today); when the project returns, the same open conversation is usable again from the live list alone: the Mate's row, its ticket and the conversation route all decide from the one live list (M15), and nothing shows a returned Mate as being born.",
      () =>
        Effect.gen(function* () {
          const s = yield* createScenario([installArea]);
          yield* s.given.project("Ada", { mate: true });
          yield* Effect.sync(() => projectGrant(s.drivers, "Ada", true));
          const chat = mateChat(s);
          chat.fixture().history();
          yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
          yield* s.given.signedIn;
          yield* chat.when.open();
          const route = new URL(s.page.url()).pathname;
          const serviceRead = "GET /service-stack/service-Ada";
          const ownServiceReads = () =>
            s.drivers.zerops.requestsByCredential.get("personal")?.get(serviceRead) ?? 0;
          const serviceReadsBefore = ownServiceReads();
          let receiverAtDenial: string | undefined;
          const recordDeniedService = () => {
            if (
              receiverAtDenial === undefined &&
              ownServiceReads() > serviceReadsBefore &&
              !s.drivers.zerops.canRead("personal", "Ada")
            )
              receiverAtDenial = [...s.drivers.zerops.subscriptions.values()].find(
                (entry) =>
                  entry.kind === "service-stack" &&
                  entry.output === "listStream" &&
                  entry.apiToken === "personal",
              )?.receiver;
          };
          s.drivers.zerops.events.on("request", recordDeniedService);
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => s.drivers.zerops.events.off("request", recordDeniedService)),
          );

          yield* Effect.sync(() => projectGrant(s.drivers, "Ada", false));
          yield* Effect.promise(() =>
            s.page.waitForFunction(
              () =>
                document.body.innerText.includes("You no longer have access to Ada's project.") &&
                ![...document.querySelectorAll('[data-zerops-surface="sidebar-mate-name"]')].some(
                  (row) => row.textContent?.includes("Ada"),
                ) &&
                ![...document.querySelectorAll('[role="textbox"]')].some(
                  (input) => input.getBoundingClientRect().height > 0,
                ),
              { polling: "raf" },
            ),
          );
          yield* Effect.logInfo("The revoked project closed its conversation");
          // A denied project and its missing service each end a receiver. Regrant only after the
          // service's denied read and its replacement receiver's baseline.
          yield* Effect.promise(() =>
            s.drivers.zerops.waitForRequest("GET /service-stack/service-Ada"),
          );
          expect(receiverAtDenial).toBeDefined();
          yield* Effect.promise(async () => {
            let check = () => {};
            try {
              await deadline(
                new Promise<void>((resolve) => {
                  check = () => {
                    const replacement = [...s.drivers.zerops.subscriptions.values()].find(
                      (entry) =>
                        entry.kind === "service-stack" &&
                        entry.output === "listStream" &&
                        entry.apiToken === "personal" &&
                        entry.receiver !== receiverAtDenial &&
                        !entry.members.has("service-Ada"),
                    );
                    if (replacement) resolve();
                  };
                  s.drivers.zerops.events.on("change", check);
                  check();
                }),
                "the replacement personal service baseline without Ada",
              );
            } finally {
              s.drivers.zerops.events.off("change", check);
            }
          });
          yield* Effect.promise(() => s.drivers.zerops.waitForRegistration("project"));
          yield* Effect.logInfo("The service denial was followed by a new baseline");
          yield* Effect.sync(() => projectGrant(s.drivers, "Ada", true));

          const row = '[data-zerops-mate-row="Ada"]';
          yield* Effect.promise(() => s.page.waitForSelector(row, { visible: true }));
          yield* Effect.logInfo("The returned Mate row appeared");
          const rowText = yield* Effect.promise(() =>
            s.page.$eval(row, (element) => element.textContent),
          );
          expect(rowText).toContain("Ada");
          expect(rowText).not.toContain("Coming up");
          yield* chat.then.text("The existing conversation is still here");
          yield* Effect.logInfo("The original conversation history appeared");
          expect(new URL(s.page.url()).pathname).toBe(route);
          yield* Effect.promise(async () => {
            await s.page.locator(`${row} [data-zerops-surface="sidebar-mate"]`).click();
            await s.page.waitForSelector('[role="textbox"]', { visible: true });
          });
          const ticket = yield* s.drivers.core.call("POST", "/api/mates/Ada/ticket", {
            session: s.drivers.owner,
          });
          expect(ticket.status).toBe(200);
          expect(new URL(s.page.url()).pathname).toBe(route);
          yield* s.then.noExternalNetwork;
        }),
    );
  });
});
