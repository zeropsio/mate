import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import {
  ProviderInstanceId,
  ServerSettings,
  ServerSettingsPatch,
  WS_METHODS,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { reportConversation } from "../b-menu/fake.ts";
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
    .filter((text) => /sign-in|signed in|signed out|authorization/iu.test(text));

describe("C: agent admission", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect(
      "Decision: one voice. When the chat’s composer shows the sign-in explanation, the header shows no separate Sign in chip for the same occurrence.",
      () =>
        Effect.gen(function* () {
          const { s, chat, wire } = yield* setup;
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
          yield* Effect.promise(() =>
            expect
              .poll(() => s.page.evaluate(signInExplanations), { timeout: 8000 })
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
          yield* chat.then.text("Update Claude to a supported version.");
          yield* chat.then.sendDisabled;
          // Only the authoritative login feed catches up; the config keeps its obsolete auth error.
          const staleProviders = [...wire.mate.config.providers];
          wire.claudeLoginFacts("ready");
          wire.providers(staleProviders);
          yield* chat.then.noText("Ada needs a Claude sign-in to continue.");
          yield* chat.then.text("Update Claude to a supported version.");
          yield* chat.then.noText("Claude Code is not signed in on this project.");
          wire.run(
            "refused",
            "error",
            "Claude's sign-in has expired. Sign Claude in again, then send a message to pick up where it left off.",
          );
          yield* reportConversation(
            s.drivers,
            "Ada",
            { session: wire.mate.thread.session, latestTurn: wire.mate.thread.latestTurn },
            "failed",
          );
          yield* Effect.promise(() =>
            expect
              .poll(
                () =>
                  s.page.$eval('[data-zerops-surface="sidebar-mate"]', (node) => node.textContent),
                { timeout: 8000 },
              )
              .toContain("Ada's turn could not continue because Claude was signed out."),
          );
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
          wire.snapshot({
            modelSelection: { instanceId, model: "sonnet" },
            session: { ...wire.mate.thread.session!, providerInstanceId: instanceId },
          });
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
              .poll(
                () =>
                  s.page.evaluate(
                    () => document.querySelector("#agent-admission button")?.textContent ?? null,
                  ),
                {
                  timeout: 8000,
                },
              )
              .toBe("Manage API key"),
          );
          yield* chat.when.press("Manage API key");
          yield* Effect.promise(() =>
            expect
              .poll(() => s.page.evaluate(() => location.pathname), { timeout: 8000 })
              .toBe("/settings/providers"),
          );
          yield* Effect.promise(() =>
            s.page
              .locator('input[aria-label="Environment variable value 1"]')
              .setTimeout(8000)
              .fill("fixture-key-repair"),
          );
          yield* chat.when.key("Enter");
          yield* Effect.promise(() =>
            expect.poll(() => repairs, { timeout: 8000 }).toEqual(["claudeAgent-work"]),
          );
          yield* chat.when.visit("/env-Ada/thread-Ada");
          yield* chat.then.noText("Manage API key");
          yield* chat.when.send("Continue the same conversation");
          expect(
            yield* Effect.promise(() => wire.waitForCommand("thread.turn.start")),
          ).toMatchObject({
            modelSelection: { instanceId: "claudeAgent-work" },
            message: { text: "Continue the same conversation" },
          });
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
        wire.snapshot({
          modelSelection: { instanceId: ProviderInstanceId.make("claudeAgent"), model: "sonnet" },
          session: null,
          latestTurn: null,
        });
        wire.turnRefusal = "Claude's sign-in has expired. Sign Claude in again.";
        wire.turnAdmissionRefusal = { loginId: "claude-code", reason: "expired-login" };
        yield* s.given.signedIn;
        yield* chat.when.open();
        yield* chat.when.attemptSend("Start work");
        yield* Effect.promise(() => wire.waitForCommand("thread.turn.start"));
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

    it.effect("A cold auth read holds sending without flashing stale sign-in guidance", () =>
      Effect.gen(function* () {
        const { s, chat, wire } = yield* setup;
        wire.claudeLoginFacts("ready");
        wire.providers(
          wire.mate.config.providers.map((provider) =>
            provider.driver === "claudeAgent"
              ? {
                  ...provider,
                  status: "error",
                  auth: { status: "unknown" },
                  message: "Claude Code is not signed in on this project. Sign it in to use it.",
                }
              : provider,
          ),
        );
        let received!: () => void;
        const subscribed = new Promise<void>((resolve) => {
          received = resolve;
        });
        wire.mate.rpcHandlers.unshift((request, socket) => {
          if (request.tag !== WS_METHODS.subscribeZeropsAgentAuth) return false;
          wire.mate.subscriptions.get(socket)!.set(request.id, request);
          received();
          return true;
        });
        yield* s.given.signedIn;
        yield* chat.when.openReadOnly();
        yield* Effect.promise(() => subscribed);
        expect(
          yield* Effect.promise(() =>
            s.page.evaluate(() => document.querySelector('[role="textbox"]') === null),
          ),
        ).toBe(true);
        expect(yield* Effect.promise(() => s.page.evaluate(signInExplanations))).toEqual([]);
        wire.publishAuth();
        yield* chat.when.send("Use the authorized login");
        expect(wire.sentTurnCount()).toBe(1);
        yield* s.then.noExternalNetwork;
      }),
    );

    it.effect(
      "Decision: refusals correlate by login identity (id), never by label or message text.",
      () =>
        Effect.gen(function* () {
          const { s, chat, wire } = yield* setup;
          const instanceId = ProviderInstanceId.make("claudeAgent-work");
          wire.claudeLoginFacts("ready");
          Object.assign(wire.mate.config.environment.capabilities, { mateLogins: true });
          const native = wire.mate.config.providers.find(
            (provider) => provider.driver === "claudeAgent",
          )!;
          wire.authSnapshot = {
            ...wire.auth(),
            logins: [
              {
                id: instanceId,
                agent: "claude-code",
                label: "before",
                signedInBy: "owner",
                kind: "subscription",
                default: false,
                state: "authorized",
                token: false,
              },
            ],
          };
          Object.assign(wire.mate.config.settings, {
            providerInstances: { [instanceId]: { driver: "claudeAgent", config: {} } },
          });
          wire.providers([{ ...native, instanceId, displayName: "Claude Code · before" }]);
          wire.snapshot({
            modelSelection: { instanceId, model: "sonnet" },
            session: { ...wire.mate.thread.session!, providerInstanceId: instanceId },
          });
          wire.turnRefusal = "The refused login had its old label: before.";
          wire.turnAdmissionRefusal = { loginId: instanceId, reason: "missing-sign-in" };
          yield* s.given.signedIn;
          yield* chat.when.open();
          yield* chat.when.send("Work on this login");
          yield* Effect.promise(() => wire.waitForCommand("thread.turn.start"));
          yield* chat.then.text("The refused login had its old label: before.");
          wire.authSnapshot = {
            ...wire.auth(),
            logins: wire
              .auth()
              .logins!.map((login) => ({ ...login, label: "after", state: "not-authorized" })),
          };
          wire.publishAuth();
          yield* Effect.promise(() =>
            expect
              .poll(
                () =>
                  s.page.evaluate(() =>
                    [...document.querySelectorAll('[role="status"], [role="alert"]')]
                      .filter(
                        (node) =>
                          node.getBoundingClientRect().height > 0 &&
                          /old label|after sign-in/.test(node.textContent ?? ""),
                      )
                      .map((node) => node.textContent),
                  ),
                { timeout: 8000 },
              )
              .toEqual(["Ada needs a Claude Code · after sign-in to continue.Sign in"]),
          );
          expect(wire.mate.thread.session?.providerInstanceId).toBe("claudeAgent-work");
          yield* s.then.noExternalNetwork;
        }),
    );

    it.effect(
      "Decision: no new Continue authorization for a viewer who cannot complete it — offer Settings instead.",
      () =>
        Effect.gen(function* () {
          const { s, chat, wire } = yield* setup;
          wire.claudeLoginFacts("signing-in");
          wire.authSnapshot = {
            ...wire.auth(),
            agents: wire
              .auth()
              .agents.map((agent) =>
                agent.agentId === "claude-code"
                  ? { ...agent, login: { ...agent.login!, startedBy: "colleague" } }
                  : agent,
              ),
          };
          wire.publishAuth();
          yield* s.given.signedIn;
          yield* chat.when.open();
          yield* Effect.promise(() =>
            expect
              .poll(
                () =>
                  s.page.evaluate(() =>
                    [...document.querySelectorAll('[role="status"], [role="alert"]')]
                      .filter(
                        (node) =>
                          node.getBoundingClientRect().height > 0 &&
                          /started .*sign-in/.test(node.textContent ?? ""),
                      )
                      .map((node) => node.textContent),
                  ),
                { timeout: 8000 },
              )
              .toEqual([
                "Another project member started Ada's Claude sign-in. Open Settings to manage this login.Settings",
              ]),
          );
          yield* chat.when.press("Settings");
          yield* Effect.promise(() =>
            expect
              .poll(() => s.page.evaluate(() => location.pathname), { timeout: 8000 })
              .toBe("/settings/providers"),
          );
          expect(wire.startedLogins).toHaveLength(0);
          yield* s.then.noExternalNetwork;
        }),
    );

    it.effect(
      "Decision: unknown is not healthy — if the auth read fails or is unsupported and the config says Not signed in, the explanation shows; only a cold, not-yet-read state is suppressed.",
      () =>
        Effect.gen(function* () {
          const { s, chat, wire } = yield* setup;
          wire.claudeLoginFacts("ready");
          wire.providers(
            wire.mate.config.providers.map((provider) =>
              provider.driver === "claudeAgent"
                ? {
                    ...provider,
                    status: "error",
                    auth: { status: "unknown" },
                    message: "Claude Code is not signed in on this project. Sign it in to use it.",
                  }
                : provider,
            ),
          );
          wire.mate.rpcHandlers.unshift((request, socket) => {
            if (request.tag !== WS_METHODS.subscribeZeropsAgentAuth) return false;
            socket.send(
              JSON.stringify({
                _tag: "Exit",
                requestId: request.id,
                exit: {
                  _tag: "Failure",
                  cause: [
                    {
                      _tag: "Fail",
                      error: {
                        _tag: "EnvironmentAuthorizationError",
                        message: "This auth read was refused.",
                        requiredScope: "orchestration:operate",
                      },
                    },
                  ],
                },
              }),
            );
            return true;
          });
          yield* s.given.signedIn;
          yield* chat.when.open();
          yield* Effect.promise(() =>
            expect
              .poll(() => s.page.evaluate(signInExplanations), { timeout: 8000 })
              .toEqual(["Ada needs a Claude sign-in to continue.Sign in"]),
          );
          yield* chat.then.sendDisabled;
          // The same config evidence still explains admission on an older server's unsupported read.
          wire.mate.rpcHandlers.shift();
          wire.authSnapshot = { available: false, reason: "unsupported", agents: [] };
          yield* chat.when.reload();
          yield* Effect.promise(() =>
            expect
              .poll(() => s.page.evaluate(signInExplanations), { timeout: 8000 })
              .toEqual(["Ada needs a Claude sign-in to continue.Sign in"]),
          );
          yield* chat.then.sendDisabled;
          yield* s.then.noExternalNetwork;
        }),
    );
  });
});
