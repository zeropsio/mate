import { scenarioSuite } from "../../harness/suite.ts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import {
  ProviderInstanceId,
  ServerSettings,
  ServerSettingsPatch,
  WS_METHODS,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import type { Page } from "puppeteer-core";
import { reportConversation } from "../b-menu/fake.ts";
import { createScenario } from "../../harness/scenario.ts";
import { installArea } from "./fake.ts";
import { mateChat } from "./dsl.ts";

const setup = Effect.gen(function* () {
  const s = yield* createScenario([installArea]);
  yield* s.given.project("Ada", { mate: true });
  const chat = mateChat(s);
  const wire = chat.fixture();
  Object.assign(wire.mate.config.environment.capabilities, { agentLoginCode: true });
  wire.history();
  wire.claudeLoginFacts("signed-out");
  wire.engine.assign({ instanceId: "claudeAgent", model: "sonnet", driver: "claudeAgent" });
  wire.run("previous-turn", "running");
  wire.run("previous-turn", "completed");
  return { s, chat, wire };
});

// Both alerts and statuses can explain a refusal; a red provider bubble must count too.
const signInExplanations = () =>
  [...document.querySelectorAll('[role="status"], [role="alert"]')]
    .filter((node) => node.getBoundingClientRect().height > 0 && !node.closest("[inert]"))
    .map((node) => node.textContent ?? "")
    .filter((text) => /sign-in|signed in|signed out|authorization/iu.test(text));

// The agent's version advisory is the model control's (S6): a dot named for it, its menu says why.
const agentUnsupported = (page: Page) =>
  Effect.promise(async () => {
    const control = "[data-chat-provider-model-picker]";
    await expect
      .poll(() =>
        page.evaluate(
          (control) =>
            [...document.querySelectorAll(`${control} [role="img"]`)].map((node) => [
              node.getAttribute("aria-label"),
              node.getAttribute("data-tone"),
            ]),
          control,
        ),
      )
      .toEqual([[expect.stringMatching(/ is unsupported$/u), "warning"]]);
    await page.click(control);
    await page.waitForFunction(() =>
      document
        .querySelector("[data-agent-availability]")
        ?.textContent?.includes("Update Claude to a supported version."),
    );
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.querySelector("[data-agent-availability]") === null);
  });

describe("C: agent admission", () => {
  scenarioSuite((it) => {
    it.effect(
      "Decision: one voice. When the chat’s composer shows the sign-in explanation, the header shows no separate Sign in chip for the same occurrence.",
      () =>
        Effect.gen(function* () {
          const { s, chat, wire } = yield* setup;
          wire.providers(
            wire.mate.config.providers.map((provider) =>
              provider.driver !== "claudeAgent"
                ? provider
                : {
                    ...provider,
                    status: "error",
                    message: "Claude Code is not signed in on this project. Sign it in to use it.",
                    compatibilityAdvisory: {
                      status: "unsupported",
                      message: "Update Claude to a supported version.",
                      recommendedVersion: null,
                      recommendedRange: null,
                    },
                  },
            ),
          );
          yield* s.given.signedIn;
          yield* chat.when.open();
          yield* Effect.promise(() =>
            expect
              .poll(() => s.page.evaluate(signInExplanations))
              .toEqual(["Ada needs a Claude sign-in to continue.Sign in"]),
          );
          expect(
            yield* Effect.promise(() =>
              s.page.evaluate(() =>
                [...document.querySelectorAll('[aria-label="Ada: Sign in"]')]
                  .filter(
                    (node) =>
                      node.getBoundingClientRect().height > 0 &&
                      !node.closest('[data-zerops-surface="sidebar-mate"]'),
                  )
                  .map((node) => node.textContent),
              ),
            ),
          ).toEqual([]);
          yield* agentUnsupported(s.page);
          yield* chat.then.sendDisabled;
          // Only the authoritative login feed catches up; the config keeps its obsolete auth error.
          const staleProviders = [...wire.mate.config.providers];
          wire.claudeLoginFacts("ready");
          wire.providers(staleProviders);
          yield* chat.then.noText("Ada needs a Claude sign-in to continue.");
          yield* agentUnsupported(s.page);
          yield* chat.then.noText("Claude Code is not signed in on this project.");
          const expired =
            "Claude's sign-in has expired. Sign Claude in again, then send a message to pick up where it left off.";
          wire.run("refused", "running");
          wire.run("refused", "error", expired);
          yield* reportConversation(
            s.drivers,
            "Ada",
            {
              session: { status: "error", lastError: expired },
              latestTurn: wire.latestTurn(),
            },
            "failed",
          );
          yield* Effect.promise(() =>
            expect
              .poll(() =>
                s.page.$eval('[data-zerops-surface="sidebar-mate"]', (node) => node.textContent),
              )
              .toContain("Ada's turn could not continue because Claude was signed out."),
          );
          yield* s.then.noExternalNetwork;
        }),
    );

    it.effect(
      "Decision: admission does not invent signer ownership. Drop unrecorded-login and any blocking derived from who signed in.",
      () =>
        Effect.gen(function* () {
          const { s, chat, wire } = yield* setup;
          const instanceId = ProviderInstanceId.make("claudeAgent-work");
          Object.assign(wire.mate.config.environment.capabilities, { mateLogins: true });
          wire.authSnapshot = {
            ...wire.auth(),
            logins: [
              {
                id: instanceId,
                agent: "claude-code",
                label: "work",
                kind: "apiKey",
                default: false,
                state: "not-authorized",
                token: false,
              },
            ],
          };
          const claude = wire.mate.config.providers.find(
            (provider) => provider.driver === "claudeAgent",
          )!;
          wire.providers([
            ...wire.mate.config.providers.filter((provider) => provider.driver !== "claudeAgent"),
            { ...claude, instanceId, displayName: "Claude API key · work" },
          ]);
          wire.engine.assign({ instanceId, model: "sonnet", driver: "claudeAgent" });
          Object.assign(wire.mate.config.settings, {
            providerInstances: {
              [instanceId]: {
                driver: "claudeAgent",
                config: { homePath: "/fixture/.mate/logins/claudeAgent-work" },
                environment: [{ name: "ANTHROPIC_API_KEY", value: "", sensitive: true }],
              },
            },
          });
          const repairs: string[] = [];
          wire.mate.rpcHandlers.unshift((request, socket) => {
            if (request.tag !== WS_METHODS.serverUpdateSettings) return false;
            const patch = Schema.decodeUnknownSync(ServerSettingsPatch)(request.payload.patch);
            Object.assign(wire.mate.config.settings, patch);
            const instances = patch.providerInstances;
            if (instances !== undefined && instances !== null) {
              repairs.push(...Object.keys(instances));
              const repaired = instances[instanceId]?.environment?.some(
                (variable) => variable.name === "ANTHROPIC_API_KEY" && variable.value.length > 0,
              );
              if (repaired) {
                wire.authSnapshot = {
                  ...wire.auth(),
                  logins: wire
                    .auth()
                    .logins!.map((login) =>
                      login.id === instanceId ? { ...login, state: "authorized" } : login,
                    ),
                };
                wire.publishAuth();
              }
            }
            wire.mate.reply(
              socket,
              request.id,
              Schema.encodeSync(ServerSettings)(wire.mate.config.settings),
            );
            return true;
          });
          yield* s.given.signedIn;
          yield* chat.when.open();
          yield* Effect.promise(() =>
            expect
              .poll(() =>
                s.page.evaluate(
                  () => document.querySelector("#agent-admission button")?.textContent ?? null,
                ),
              )
              .toBe("Manage API key"),
          );
          yield* chat.when.press("Manage API key");
          yield* Effect.promise(() =>
            expect.poll(() => s.page.evaluate(() => location.pathname)).toBe("/settings/providers"),
          );
          yield* Effect.promise(() =>
            s.page
              .locator('input[aria-label="Environment variable value 1"]')
              .fill("fixture-key-repair"),
          );
          yield* chat.when.key("Enter");
          yield* Effect.promise(() => expect.poll(() => repairs).toEqual(["claudeAgent-work"]));
          yield* chat.when.visit("/env-Ada/thread-Ada");
          yield* chat.then.noText("Manage API key");
          yield* chat.when.send("Continue the same conversation");
          yield* Effect.promise(() => wire.waitForTurn("Continue the same conversation"));
          expect(wire.engine.header.agent?.instanceId).toBe("claudeAgent-work");
          expect(wire.startedLogins).toHaveLength(0);
          yield* s.then.noExternalNetwork;
        }),
    );

    it.effect("A refused first turn has one explanation scoped to the attempted login", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([installArea]);
        yield* s.given.project("Ada", { mate: true });
        const chat = mateChat(s);
        const wire = chat.fixture();
        wire.history();
        wire.claudeLoginFacts("ready");
        wire.providers(
          wire.mate.config.providers.filter((provider) => provider.driver === "claudeAgent"),
        );
        wire.engine.assign({ instanceId: "claudeAgent", model: "sonnet", driver: "claudeAgent" });
        wire.engine.admissionRefusal = "Claude's sign-in has expired. Sign Claude in again.";
        wire.engine.admissionRefusedLogin = { loginId: "claude-code", reason: "expired-login" };
        yield* s.given.signedIn;
        yield* chat.when.open();
        yield* chat.when.attemptSend("Start work");
        yield* Effect.promise(() => wire.waitForOp("send"));
        yield* chat.then.text("Claude was signed out.");
        wire.authSnapshot = {
          ...wire.auth(),
          agents: wire.auth().agents.map((agent) =>
            agent.agentId === "claude-code"
              ? {
                  ...agent,
                  state: "not-authorized",
                  credPresent: false,
                  flagOAuth: false,
                  providerAuth: "unauthenticated",
                  authorizedBy: undefined,
                }
              : agent,
          ),
        };
        wire.publishAuth();
        yield* chat.then.text("Ada needs a Claude sign-in to continue.");
        expect(yield* Effect.promise(() => s.page.evaluate(signInExplanations))).toEqual([
          "Ada needs a Claude sign-in to continue.Sign in",
        ]);
        yield* chat.then.draft("Start work");
        yield* chat.then.sendDisabled;
        yield* s.then.noExternalNetwork;
      }),
    );
  });
});
