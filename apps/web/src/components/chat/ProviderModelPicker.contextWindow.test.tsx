// @vitest-environment happy-dom
import {
  ConversationId,
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type ConversationHeader,
  type EngineCallResult,
  type ModelSelection,
  type ServerProvider,
} from "@t3tools/contracts";
import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";
import { EnvironmentRegistry, EnvironmentSupervisor } from "@t3tools/client-runtime/connection";
import {
  engineConversationId,
  engineConversationScopes,
  makeAccountStore,
  makeMateEngineOperations,
  mateEngineHostAtom,
  type EngineCommand,
  type MateEngineHost,
} from "@t3tools/client-runtime/data";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { createThreadEnvironmentAtoms } from "@t3tools/client-runtime/state/threads";
import { createModelCapabilities } from "@t3tools/shared/model";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { Atom, AtomRegistry } from "effect/reactivity";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { it } from "@effect/vitest";
import { describe, expect, vi } from "vite-plus/test";

import { useComposerDraftStore, useEffectiveComposerModelState } from "../../composerDraftStore";
import { deriveProviderInstanceEntries } from "../../providerInstances";
import { getProviderModelCapabilities } from "../../providerModels";
import { useThreadModelSelection } from "../../zerops/useThreadModelSelection";
import { ComposerModelChoices } from "./ComposerModelControl";
import { ProviderModelPicker } from "./ProviderModelPicker";
import { getTraitsSectionVisibility } from "./TraitsPicker";

const ENV = EnvironmentId.make("environment-local");
const THREAD = ThreadId.make("t");
const CODEX = ProviderInstanceId.make("codex");
const DRIVER = ProviderDriverKind.make("codex");
const MODEL = "gpt-6-luna";
const threadRef = scopeThreadRef(ENV, THREAD);
const capabilities = createModelCapabilities({
  optionDescriptors: [
    {
      id: "contextWindow",
      label: "Context Window",
      type: "select",
      currentValue: "272000",
      options: [
        { id: "272000", label: "272k", isDefault: true },
        { id: "872000", label: "872k" },
      ],
    },
  ],
});

function provider(known: boolean): ServerProvider {
  return {
    instanceId: CODEX,
    driver: DRIVER,
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-10-13T00:00:00.000Z",
    models: [
      {
        slug: MODEL,
        name: "GPT-6-Luna",
        isCustom: false,
        isDefault: true,
        capabilities: known ? capabilities : null,
      },
    ],
    slashCommands: [],
    skills: [],
  };
}

describe("C: Codex context window", () => {
  it.effect(
    "Codex's catalog window arriving after first paint is selectable, checked and reversible in the shared model picker",
    () =>
      Effect.gen(function* () {
        const prepared = yield* SubscriptionRef.make(Option.some({ mateEngine: 1 }));
        yield* Effect.promise(async () => {
          vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
          useComposerDraftStore.setState({ draftsByThreadKey: {}, draftThreadsByThreadKey: {} });
          const registry = AtomRegistry.make();
          const store = makeAccountStore(registry);
          const calls: EngineCommand[] = [];
          let commandId = 0;
          const operations = makeMateEngineOperations({
            store,
            makeId: () => `op-${++commandId}`,
            wire: {
              call: (_environmentId, command) => {
                calls.push(command);
                return Effect.succeed({
                  _tag: "Accepted",
                  seq: commandId,
                  itemId: "x",
                } as EngineCallResult);
              },
              receipt: () => Effect.succeed({ _tag: "None" }),
            },
          });
          registry.set(mateEngineHostAtom, { store, operations } as unknown as MateEngineHost);
          const runtime = Atom.runtime(
            Layer.mergeAll(
              Layer.succeed(EnvironmentRegistry, {
                run: (_id, effect) =>
                  effect.pipe(
                    Effect.provideService(EnvironmentSupervisor, {
                      target: { environmentId: ENV },
                      prepared,
                    } as never),
                  ),
              } as EnvironmentRegistry["Service"]),
              Layer.succeed(
                Crypto.Crypto,
                Crypto.make({
                  randomBytes: (size) => new Uint8Array(size),
                  digest: (_algorithm, data) => Effect.succeed(data),
                }),
              ),
            ),
          );
          const providersAtom = Atom.make<ReadonlyArray<ServerProvider> | null>(null);
          const commands = createThreadEnvironmentAtoms(runtime, () => Atom.make(null), {
            providersAtom: () => providersAtom,
          });
          const writes: Array<ReturnType<typeof commands.updateMetadata.run>> = [];
          const write = (modelSelection: ModelSelection) => {
            writes.push(
              commands.updateMetadata.run(registry, {
                environmentId: ENV,
                input: { threadId: THREAD, modelSelection },
              }),
            );
          };
          const root = createRoot(document.body.appendChild(document.createElement("div")));
          const selection = (value?: string): ModelSelection => ({
            instanceId: CODEX,
            model: MODEL,
            ...(value === undefined ? {} : { options: [{ id: "contextWindow", value }] }),
          });
          const publish = (selected: ModelSelection, seq: number) => {
            const key = { environmentId: ENV, conversationId: THREAD };
            const header = {
              conversationId: ConversationId.make(THREAD),
              agent: {
                instanceId: CODEX,
                driver: DRIVER,
                model: MODEL,
                profile: { kind: "mate" },
                ...(selected.options === undefined ? {} : { options: selected.options }),
              },
              archived: false,
              runStatus: "ready",
              activeRunId: null,
              latestRunId: null,
              model: MODEL,
              session: null,
              pausedUntil: null,
              queued: 0,
            } as ConversationHeader;
            store.dispatch({
              kind: "delivery",
              via: "mate-direct",
              scopes: Object.values(engineConversationScopes(key)).map((scope) => ({
                scope,
                generation: 0,
              })),
              reset: true,
              rows: [
                {
                  family: "mateEngineConversation",
                  id: engineConversationId(key),
                  value: {
                    environmentId: ENV,
                    header,
                    window: { oldestOrdinal: null, earlier: false },
                  },
                  revision: { kind: "mate-conversation", environmentId: ENV, epoch: 1, seq },
                },
              ],
              removals: [],
            });
          };

          function Picker({
            catalog,
            selected,
          }: {
            catalog: ServerProvider;
            selected: ModelSelection;
          }) {
            const providers = [catalog];
            const { modelOptions, selectedModel } = useEffectiveComposerModelState({
              threadRef,
              providers,
              selectedProvider: DRIVER,
              selectedInstanceId: CODEX,
              threadModelSelection: selected,
              projectModelSelection: null,
              settings: DEFAULT_UNIFIED_SETTINGS,
            });
            useThreadModelSelection({
              threadRef,
              threadSelection: selected,
              write,
              capabilitiesFor: (value) =>
                getProviderModelCapabilities(catalog.models, value.model, DRIVER),
            });
            const traitsInput = {
              provider: DRIVER,
              instanceId: CODEX,
              models: catalog.models,
              model: selectedModel,
              prompt: "",
              onPromptChange: () => {},
              modelOptions: modelOptions?.[CODEX],
              planModeEnabled: false,
              threadRef,
            };
            const traits = getTraitsSectionVisibility(traitsInput);
            return (
              <ProviderModelPicker
                activeInstanceId={CODEX}
                model={selectedModel}
                lockedProvider={null}
                instanceEntries={deriveProviderInstanceEntries(providers)}
                modelOptionsByInstance={new Map([[CODEX, [{ slug: MODEL, name: "GPT-6-Luna" }]]])}
                composer={{
                  traits,
                  choices: (
                    <ComposerModelChoices
                      traits={traitsInput}
                      runtimeMode="full-access"
                      onRuntimeModeChange={() => {}}
                    />
                  ),
                  shortcuts: "composer.effort composer.mode",
                }}
                open
                onInstanceModelChange={() => {}}
              />
            );
          }
          const render = async (known: boolean, selected: ModelSelection) => {
            const catalog = provider(known);
            registry.set(providersAtom, [catalog]);
            await act(async () => root.render(<Picker catalog={catalog} selected={selected} />));
          };
          const radios = () =>
            Array.from(
              document.querySelectorAll(
                '[role="radiogroup"][aria-label="Context Window"] [role="radio"]',
              ),
            );
          try {
            publish(selection(), 1);
            await render(false, selection());
            expect(radios()).toEqual([]);
            await render(true, selection());
            expect(
              radios().map((node) => ({
                text: node.textContent,
                checked: node.getAttribute("aria-checked"),
              })),
            ).toEqual([
              { text: "272kDefault", checked: "true" },
              { text: "872k", checked: "false" },
            ]);
            await act(async () => (radios()[1] as HTMLButtonElement).click());
            expect((await writes[0]!)._tag).toBe("Success");
            expect(calls[0]).toMatchObject({
              kind: "switch-model",
              options: [{ id: "contextWindow", value: "872000" }],
            });
            expect(radios()[1]?.getAttribute("aria-checked")).toBe("true");
            publish(selection("872000"), 2);
            await render(true, selection("872000"));
            await act(async () => (radios()[0] as HTMLButtonElement).click());
            expect((await writes[1]!)._tag).toBe("Success");
            expect(calls[1]).toMatchObject({
              kind: "switch-model",
              options: [{ id: "contextWindow", value: "272000" }],
            });
            expect(radios()[0]?.getAttribute("aria-checked")).toBe("true");
          } finally {
            await act(async () => root.unmount());
            operations.close();
            registry.dispose();
            document.body.innerHTML = "";
            vi.unstubAllGlobals();
          }
        });
      }),
  );
});
