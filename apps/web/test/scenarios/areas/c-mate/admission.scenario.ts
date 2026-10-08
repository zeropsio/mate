import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { ProviderInstanceId } from "@t3tools/contracts";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
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
  wire.run("previous-turn", "completed");
  wire.snapshot({
    modelSelection: { instanceId: ProviderInstanceId.make("claudeAgent"), model: "sonnet" },
    session: {
      ...wire.mate.thread.session!,
      providerName: "claudeAgent",
      providerInstanceId: ProviderInstanceId.make("claudeAgent"),
    },
  });
  return { s, chat, wire };
});

// Both alerts and statuses can explain a refusal; a red provider bubble must count too.
const signInExplanations = () =>
  [...document.querySelectorAll('[role="status"], [role="alert"]')]
    .filter((node) => node.getBoundingClientRect().height > 0 && !node.closest("[inert]"))
    .map((node) => node.textContent ?? "")
    .filter((text) => /sign-in|signed in|authorization/iu.test(text));

describe("C: agent admission", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect("A missing agent sign-in has one actionable explanation", () =>
      Effect.gen(function* () {
        const { s, chat, wire } = yield* setup;
        wire.run(
          "refused",
          "error",
          "Claude's sign-in has expired. Sign Claude in again, then send a message to pick up where it left off.",
        );
        wire.snapshot({
          session: {
            ...wire.mate.thread.session!,
            providerName: "claudeAgent",
            providerInstanceId: ProviderInstanceId.make("claudeAgent"),
          },
        });
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
        yield* chat.then.text("Ada needs a Claude sign-in to continue.");
        expect(yield* Effect.promise(() => s.page.evaluate(signInExplanations))).toEqual([
          "Ada needs a Claude sign-in to continue.Sign in",
        ]);
        yield* chat.then.text("Update Claude to a supported version.");
        yield* chat.then.sendDisabled;
        // Only the authoritative login feed catches up; the config keeps its obsolete auth error.
        const staleProviders = [...wire.mate.config.providers];
        wire.claudeLoginFacts("ready");
        wire.providers(staleProviders);
        yield* chat.then.noText("Ada needs a Claude sign-in to continue.");
        yield* chat.then.text("Update Claude to a supported version.");
        yield* chat.then.noText("Claude Code is not signed in on this project.");
        yield* s.then.noExternalNetwork;
      }),
    );

    it.effect("An active sign-in requirement cannot be dismissed and survives remount", () =>
      Effect.gen(function* () {
        const { s, chat, wire } = yield* setup;
        yield* s.given.signedIn;
        yield* chat.when.open();
        yield* chat.then.text("Ada needs a Claude sign-in to continue.");
        expect(
          yield* Effect.promise(() =>
            s.page.evaluate(
              () => document.querySelector('#agent-admission [aria-label^="Dismiss"]') === null,
            ),
          ),
        ).toBe(true);
        yield* Effect.promise(() => s.page.locator("#agent-admission button").click());
        yield* chat.then.text("Sign Ada in");
        wire.claudeLoginFacts("signing-in");
        wire.authSnapshot = {
          ...wire.auth(),
          agents: wire.auth().agents.map((agent) =>
            agent.agentId === "claude-code"
              ? {
                  ...agent,
                  login: { ...agent.login!, url: "https://claude.ai/fixture-authorization" },
                }
              : agent,
          ),
        };
        wire.publishAuth();
        yield* chat.when.key("Escape");
        yield* chat.then.noText("Sign Ada in");
        yield* chat.when.reload();
        yield* Effect.promise(() =>
          expect
            .poll(() => s.page.evaluate(signInExplanations), { timeout: 8000 })
            .toEqual([
              "Ada's Claude sign-in is not finished. Continue authorization to use it.Continue authorization",
            ]),
        );
        yield* chat.then.sendDisabled;
        yield* chat.when.press("Continue authorization");
        yield* chat.then.text("Sign Ada in");
        yield* Effect.promise(() =>
          expect
            .poll(
              () =>
                s.page.$eval('a[href="https://claude.ai/fixture-authorization"]', (link) =>
                  link.getAttribute("href"),
                ),
              { timeout: 8000 },
            )
            .toBe("https://claude.ai/fixture-authorization"),
        );
        wire.claudeLoginFacts("ready");
        yield* chat.when.key("Escape");
        yield* chat.then.noText("Continue authorization to use it.");
        expect(wire.sentTurnCount()).toBe(0);
        yield* s.then.noExternalNetwork;
      }),
    );

    it.effect(
      "A missing API key opens its repair controls instead of subscription authorization",
      () =>
        Effect.gen(function* () {
          const { s, chat, wire } = yield* setup;
          const instanceId = ProviderInstanceId.make("claude-key");
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
          wire.snapshot({
            modelSelection: { instanceId, model: "sonnet" },
            session: { ...wire.mate.thread.session!, providerInstanceId: instanceId },
          });
          yield* s.given.signedIn;
          yield* chat.when.open();
          yield* Effect.promise(() =>
            s.page.waitForSelector("#agent-admission button", { visible: true }),
          );
          yield* Effect.promise(() =>
            expect
              .poll(() => s.page.$eval("#agent-admission button", (button) => button.textContent), {
                timeout: 8000,
              })
              .toBe("Manage API key"),
          );
          yield* chat.when.press("Manage API key");
          yield* chat.then.text("Claude API key · work");
          yield* Effect.promise(() =>
            s.page.locator('[data-zerops-add-login="claude-code"]').click(),
          );
          yield* chat.when.press("API key");
          yield* chat.then.control("Anthropic API key", "textbox");
          expect(wire.startedLogins).toHaveLength(0);
          yield* s.then.noExternalNetwork;
        }),
    );
  });
});
