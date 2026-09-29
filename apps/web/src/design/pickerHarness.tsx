/**
 * The composer's model menu (C4), opened from its one quiet control at the
 * composer's foot: the models beside a Claude model's seven efforts, its two
 * context windows, its fast mode and the four accesses — a right column taller
 * than the menu, so it scrolls. Beside it, the composer's other menus: the
 * access on its own, the effort menu the settings use and the context
 * window's popover, and a header menu.
 *
 * Served by the dev server at `/design-picker.html` (`?theme=dark`,
 * `?instance=codex` for a model with no traits, whose column holds only the
 * access and fits). Open it at the owner's 1786 × 1000 and at a short window
 * (1786 × 700): the room above the composer is what the menu must fit in from
 * its first frame.
 * `window.__pickerHarness.sample("model")` opens a menu from a script and
 * resolves with the popup's box on every frame until it settles, so a
 * per-frame check needs no pointer.
 *
 * Fixtures only. Nothing here ships — `design-picker.html` is not
 * `index.html`, and no route imports this module.
 */
import {
  EventId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderOptionDescriptor,
  type ProviderOptionSelection,
  type RuntimeMode,
  type ServerProvider,
  type ServerProviderModel,
  TurnId,
} from "@t3tools/contracts";
import { EllipsisIcon } from "lucide-react";
import { StrictMode, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

import {
  ComposerAccessControl,
  ComposerModelChoices,
  type ComposerTraitsInput,
} from "~/components/chat/ComposerModelControl";
import { ContextWindowMeter } from "~/components/chat/ContextWindowMeter";
import { ProviderModelPicker } from "~/components/chat/ProviderModelPicker";
import { TraitsPicker, getTraitsSectionVisibility } from "~/components/chat/TraitsPicker";
import type { ModelEsque } from "~/components/chat/providerIconUtils";
import { Button } from "~/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import { deriveLatestContextWindowSnapshot } from "~/lib/contextWindow";
import { deriveProviderInstanceEntries } from "~/providerInstances";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import "../index.css";

const params = new URLSearchParams(location.search);

// ---------------------------------------------------------------------------
// The catalog: a Claude model's traits as the server's manifest has them.
// ---------------------------------------------------------------------------

const CLAUDE = ProviderDriverKind.make("claudeAgent");
const CODEX = ProviderDriverKind.make("codex");
const CLAUDE_ID = ProviderInstanceId.make("claudeAgent");
const CODEX_ID = ProviderInstanceId.make("codex");

const CLAUDE_TRAITS: ReadonlyArray<ProviderOptionDescriptor> = [
  {
    id: "effort",
    label: "Reasoning",
    type: "select",
    options: [
      { id: "low", label: "Low" },
      { id: "medium", label: "Medium", isDefault: true },
      { id: "high", label: "High" },
      { id: "xhigh", label: "Extra High" },
      { id: "max", label: "Max" },
      {
        id: "ultracode",
        label: "Ultracode",
        description: "xhigh effort plus multi-agent workflow orchestration",
      },
      { id: "ultrathink", label: "Ultrathink" },
    ],
    promptInjectedValues: ["ultrathink"],
  },
  { id: "fastMode", label: "Fast Mode", type: "boolean" },
  {
    id: "contextWindow",
    label: "Context Window",
    type: "select",
    options: [
      { id: "200k", label: "200k" },
      { id: "1m", label: "1M", isDefault: true },
    ],
  },
];

function claudeModel(
  slug: string,
  name: string,
  extra: Partial<Pick<ServerProviderModel, "badge" | "isLegacy">> = {},
): ServerProviderModel {
  return {
    slug,
    name,
    isCustom: false,
    ...extra,
    capabilities: { optionDescriptors: CLAUDE_TRAITS },
  };
}

const CLAUDE_MODELS: ReadonlyArray<ServerProviderModel> = [
  claudeModel("claude-opus-5-5", "Claude Opus 5.5", { badge: "new" }),
  claudeModel("claude-fable-5-1", "Claude Fable 5.1"),
  claudeModel("claude-sonnet-5-5", "Claude Sonnet 5.5", { badge: "new" }),
  ...[
    ["claude-opus-5", "Claude Opus 5"],
    ["claude-sonnet-5", "Claude Sonnet 5"],
    ["claude-fable-5", "Claude Fable 5"],
    ["claude-opus-4-8", "Claude Opus 4.8"],
    ["claude-sonnet-4-8", "Claude Sonnet 4.8"],
    ["claude-haiku-4-8", "Claude Haiku 4.8"],
    ["claude-opus-4-5", "Claude Opus 4.5"],
    ["claude-sonnet-4-5", "Claude Sonnet 4.5"],
    ["claude-haiku-4-5", "Claude Haiku 4.5"],
  ].map(([slug, name]) => claudeModel(slug!, name!, { isLegacy: true })),
];

const CODEX_MODELS: ReadonlyArray<ServerProviderModel> = [
  ["gpt-6-sol", "GPT-6 Sol"],
  ["gpt-6-luna", "GPT-6 Luna"],
  ["gpt-6-astra", "GPT-6 Astra"],
].map(([slug, name]) => ({ slug: slug!, name: name!, isCustom: false, capabilities: null }));

function provider(
  instanceId: ProviderInstanceId,
  driver: ProviderDriverKind,
  models: ReadonlyArray<ServerProviderModel>,
): ServerProvider {
  return {
    instanceId,
    driver,
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-09-29T07:00:00.000Z",
    models,
    slashCommands: [],
    skills: [],
  };
}

const INSTANCE_ENTRIES = deriveProviderInstanceEntries([
  provider(CLAUDE_ID, CLAUDE, CLAUDE_MODELS),
  provider(CODEX_ID, CODEX, CODEX_MODELS),
]);

const toOptions = (models: ReadonlyArray<ServerProviderModel>): ReadonlyArray<ModelEsque> =>
  models.map((model) => ({
    slug: model.slug,
    name: model.name,
    ...(model.badge ? { badge: model.badge } : {}),
    ...(model.isLegacy ? { isLegacy: true } : {}),
  }));

const MODEL_OPTIONS = new Map<ProviderInstanceId, ReadonlyArray<ModelEsque>>([
  [CLAUDE_ID, toOptions(CLAUDE_MODELS)],
  [CODEX_ID, toOptions(CODEX_MODELS)],
]);

/** Each agent's driver and models; `?instance=codex` starts on a model with no traits. */
const CATALOG = new Map([
  [CLAUDE_ID, { driver: CLAUDE, models: CLAUDE_MODELS }],
  [CODEX_ID, { driver: CODEX, models: CODEX_MODELS }],
]);
const START =
  params.get("instance") === "codex"
    ? { instanceId: CODEX_ID, model: "gpt-6-sol" }
    : { instanceId: CLAUDE_ID, model: "claude-opus-5-5" };

/** The context window the meter beside the controls reads: 412k of 1M used. */
const USAGE = deriveLatestContextWindowSnapshot([
  {
    id: EventId.make("activity-context"),
    tone: "info",
    kind: "context-window.updated",
    summary: "Context updated",
    payload: { usedTokens: 412_000, maxTokens: 1_000_000 },
    turnId: TurnId.make("turn-harness"),
    createdAt: "2026-09-29T07:00:00.000Z",
  },
]);

// ---------------------------------------------------------------------------
// The page: a conversation, the composer at its foot, a header on top.
// ---------------------------------------------------------------------------

const WORDS = [
  "Deployed the storefront to stage and ran the checkout in the browser: the cart keeps its items across a reload now, and the order total rounds the same way the invoice does.",
  "The build on stage failed on a missing environment variable, so I added it to the service's settings and started the pipeline again. It went through in 1m 48s.",
  "Measured the product list's first load before changing anything: 2.4 s, most of it one query without an index. With the index it loads in 380 ms.",
];

function Harness() {
  const [model, setModel] = useState(START.model);
  const [instanceId, setInstanceId] = useState(START.instanceId);
  const [prompt, setPrompt] = useState("");
  const [runtimeMode, setRuntimeMode] = useState<RuntimeMode>("full-access");
  const [modelOptions, setModelOptions] = useState<
    ReadonlyArray<ProviderOptionSelection> | undefined
  >([{ id: "effort", value: "max" }]);

  const { driver, models } = CATALOG.get(instanceId) ?? CATALOG.get(CLAUDE_ID)!;
  const traits: ComposerTraitsInput = {
    provider: driver,
    models,
    model,
    prompt,
    onPromptChange: setPrompt,
    modelOptions,
    planModeEnabled: false,
    onModelOptionsChange: setModelOptions,
  };
  const { descriptors, ultrathinkPromptControlled } = useMemo(
    () =>
      getTraitsSectionVisibility({
        provider: driver,
        models,
        model,
        prompt,
        modelOptions,
        planModeEnabled: false,
      }),
    [driver, model, modelOptions, models, prompt],
  );

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex h-12 shrink-0 items-center justify-end border-border border-b px-4">
        <Menu>
          <MenuTrigger
            data-harness-menu="header"
            render={<Button aria-label="More" size="icon-sm" variant="ghost" />}
          >
            <EllipsisIcon />
          </MenuTrigger>
          <MenuPopup align="end">
            {["Rename", "Copy link", "Open in editor", "Show the log", "Archive"].map((label) => (
              <MenuItem key={label}>{label}</MenuItem>
            ))}
          </MenuPopup>
        </Menu>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-8 text-prose">
          {Array.from({ length: 24 }, (_, index) => (
            <p key={index}>{WORDS[index % WORDS.length]}</p>
          ))}
        </div>
      </main>
      <div className="mx-auto w-full max-w-3xl shrink-0 px-6 pb-4">
        <div className="rounded-3xl border border-border bg-card">
          <p className="px-5 pt-4 pb-2 text-muted-foreground text-prose">Ask Nova anything…</p>
          <div className="flex items-center gap-2 pt-1.5 pe-3 pb-3 ps-3.5">
            <ProviderModelPicker
              activeInstanceId={instanceId}
              model={model}
              lockedProvider={null}
              instanceEntries={INSTANCE_ENTRIES}
              modelOptionsByInstance={MODEL_OPTIONS}
              composer={{
                traits: { descriptors, ultrathinkPromptControlled },
                choices: (
                  <ComposerModelChoices
                    traits={traits}
                    runtimeMode={runtimeMode}
                    onRuntimeModeChange={setRuntimeMode}
                  />
                ),
                shortcuts: "composer.effort composer.mode",
              }}
              onInstanceModelChange={(nextInstanceId, nextModel) => {
                setInstanceId(nextInstanceId);
                setModel(nextModel);
              }}
            />
            <ComposerAccessControl runtimeMode={runtimeMode} onRuntimeModeChange={setRuntimeMode} />
            <TraitsPicker {...traits} />
            <span className="flex-1" />
            {USAGE === null ? null : <ContextWindowMeter usage={USAGE} onCompact={() => {}} />}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The per-frame sampler.
// ---------------------------------------------------------------------------

const TRIGGERS = {
  model: "[data-chat-provider-model-picker]",
  access: '[data-composer-shortcut="composer.mode"]',
  traits: '[data-composer-shortcut="composer.effort"]:not([data-chat-provider-model-picker])',
  header: '[data-harness-menu="header"]',
  meter: '[aria-label^="Context window"]',
} as const;

const POPUPS = '[data-slot="popover-popup"], [data-slot="menu-popup"], [data-slot="select-popup"]';

interface FrameSample {
  readonly frame: number;
  readonly ms: number;
  readonly opacity: number;
  /** The popup's box as painted, its entrance's scale included. */
  readonly top: number;
  readonly height: number;
  /** The positioner's height: taller than the popup, the rest is a box nobody sees. */
  readonly positionerHeight: number;
  /** The room beside the trigger, as Base UI measured it (`--available-height`). */
  readonly room: string;
  /** The scroller inside whose content overflows most: its height and its content's. */
  readonly scroller: { readonly height: number; readonly content: number } | null;
}

function effectiveOpacity(element: Element | null): number {
  let opacity = 1;
  for (let node = element; node !== null; node = node.parentElement) {
    opacity *= Number(getComputedStyle(node).opacity);
  }
  return Math.round(opacity * 100) / 100;
}

function measure(frame: number, start: number): FrameSample | null {
  const popup = document.querySelector<HTMLElement>(POPUPS);
  if (popup === null) return null;
  const box = popup.getBoundingClientRect();
  const positioner = popup.parentElement;
  const scroller = [...popup.querySelectorAll<HTMLElement>("*")]
    .filter((node) => /(auto|scroll)/.test(getComputedStyle(node).overflowY))
    .toSorted((a, b) => b.scrollHeight - b.clientHeight - (a.scrollHeight - a.clientHeight))[0];
  return {
    frame,
    ms: Math.round(performance.now() - start),
    opacity: effectiveOpacity(popup),
    top: Math.round(box.top),
    height: Math.round(box.height),
    positionerHeight: Math.round(positioner?.getBoundingClientRect().height ?? 0),
    room: positioner?.style.getPropertyValue("--available-height") ?? "",
    scroller:
      scroller === undefined
        ? null
        : { height: scroller.clientHeight, content: scroller.scrollHeight },
  };
}

/**
 * Opens a menu and resolves with the popup's box on every animation frame
 * for `frames` frames, and where its trigger's top stands.
 */
function sample(which: keyof typeof TRIGGERS, frames = 45) {
  const trigger = document.querySelector<HTMLElement>(TRIGGERS[which]);
  if (trigger === null) return Promise.reject(new Error(`no trigger for ${which}`));
  const triggerTop = Math.round(trigger.getBoundingClientRect().top);
  const samples: FrameSample[] = [];
  const start = performance.now();
  return new Promise<{ triggerTop: number; samples: FrameSample[] }>((resolve) => {
    let frame = 0;
    const tick = () => {
      frame += 1;
      const measured = measure(frame, start);
      if (measured !== null) samples.push(measured);
      if (frame < frames) requestAnimationFrame(tick);
      else resolve({ triggerTop, samples });
    };
    trigger.click();
    requestAnimationFrame(tick);
  });
}

(window as unknown as { __pickerHarness: unknown }).__pickerHarness = { sample };

// The app sets the theme on the document element (`themePalette.ts`), so the
// harness does the same.
const appearance = params.get("theme") === "dark" ? "dark" : "light";
document.documentElement.classList.toggle("dark", appearance === "dark");
applyThemePalette(ZEROPS_THEME_ID, appearance);

const host = document.getElementById("design");
if (host) {
  createRoot(host).render(
    <StrictMode>
      <Harness />
    </StrictMode>,
  );
}
