// @vitest-environment happy-dom
import type {
  VaultAskActivityPayload,
  VaultScopeRef,
  VaultWrite,
} from "@t3tools/client-runtime/data";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { AskDensity } from "../../ask/AskCard";
import { VaultAsk } from "./VaultAsk";
import type { VaultWriteOutcome } from "./VaultPanel";
import { VAULT_FIXTURE, VAULT_FIXTURE_NOW } from "./vaultFixture";
import {
  type VaultAsk as VaultAskModel,
  type VaultAskPress,
  vaultAskState,
  vaultAskView,
} from "./vaultRequest.logic";

let root: Root | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const ask = (over: Partial<VaultAskModel> = {}): VaultAskModel => ({
  key: "NEW_STRIPE_KEY",
  label: "Stripe secret key",
  scope: { kind: "shared" },
  sensitive: true,
  reason: "for the questionnaire API",
  askedAt: new Date(VAULT_FIXTURE_NOW - 5 * 60_000).toISOString(),
  ...over,
});

type Record = Pick<VaultAskActivityPayload, "state" | "answer">;
const OPEN: Record = { state: "open", answer: null };
const ana = { kind: "person", subject: "user-ana" } as const;

interface Mounted {
  readonly container: HTMLElement;
  readonly saves: Array<{ scope: VaultScopeRef; write: VaultWrite }>;
  readonly said: Array<"not-now" | "use-given" | "show">;
}

/**
 * The card as its container draws it: the engine's record and the fixture vault are its sources;
 * a press stays under way until it is refused (`answer`), which the card then says.
 */
async function mount(
  asked: VaultAskModel,
  options: {
    readonly answer?: VaultWriteOutcome;
    readonly record?: Record;
    readonly density?: AskDensity;
    readonly pending?: VaultAskPress | null;
  } = {},
): Promise<Mounted> {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const { answer = { ok: true }, record = OPEN, density = "full" } = options;
  const saves: Mounted["saves"] = [];
  const said: Mounted["said"] = [];
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const vault = vaultAskState(VAULT_FIXTURE, asked);
  function Harness() {
    const [refusal, setRefusal] = useState<string | null>(null);
    return (
      <VaultAsk
        ask={asked}
        askId="mate/r/1/q/1"
        density={density}
        mateName="Milo"
        onNotNow={() => said.push("not-now")}
        onSave={async (scope, write) => {
          saves.push({ scope, write });
          setRefusal(answer.ok ? null : (answer.message ?? "Zerops did not take it."));
          return answer.ok;
        }}
        onShowInConversation={density === "compact" ? () => said.push("show") : undefined}
        onUseGiven={() => said.push("use-given")}
        vault={vault}
        view={vaultAskView({
          ask: asked,
          mateName: "Milo",
          record,
          vault,
          pending: options.pending ?? null,
          refusal,
          nameOf: (subject) => (subject === "user-ana" ? "Aleš" : undefined),
          clock: () => "15:04",
        })}
      />
    );
  }
  await act(async () => root!.render(<Harness />));
  return { container, saves, said };
}

const field = (container: Element) =>
  container.querySelector<HTMLInputElement>("input:not([type=checkbox])");
const button = (container: Element, words: string) =>
  [...container.querySelectorAll("button")].find(
    (candidate) =>
      candidate.textContent?.trim() === words || candidate.getAttribute("aria-label") === words,
  ) as HTMLButtonElement | undefined;
const keepHidden = (container: Element) =>
  container.querySelector<HTMLElement>('[role="checkbox"]') ?? undefined;
const footer = (container: Element) => container.querySelector("[data-ask-footer]");

async function type(container: Element, value: string) {
  const input = field(container)!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function click(target: HTMLElement | undefined) {
  await act(async () => target!.click());
}

describe("the Mate asks for a value on the ask card", () => {
  it("names where the value goes and the Mate's why, behind a masked field, Keep hidden on, Save to vault and Not now", async () => {
    const { container } = await mount(ask());
    const card = container.querySelector('[data-ask-kind="vault"]');
    expect(card?.getAttribute("aria-label")).toBe("Add NEW_STRIPE_KEY to Milo's vault");
    expect(container.textContent).toContain("This Mate · every app");
    expect(container.querySelector("[data-ask-why]")?.textContent).toBe(
      "Milo: for the questionnaire API",
    );
    expect(container.querySelector("label")?.textContent).toBe("Stripe secret key");
    expect(field(container)?.hasAttribute("data-secret")).toBe(true);
    expect(field(container)?.getAttribute("autocomplete")).toBe("off");
    expect(keepHidden(container)?.getAttribute("aria-checked")).toBe("true");
    expect(button(container, "Save to vault")?.disabled).toBe(true);
    expect(button(container, "Not now")).toBeDefined();
    expect(container.textContent).toContain("Goes to the vault, not the chat");
    expect(container.querySelector("[data-vault-ask-warning]")).toBeNull();
  });

  it("the field is masked until the person shows it, whatever the agent asked", async () => {
    const { container } = await mount(ask({ sensitive: false }));
    expect(field(container)?.hasAttribute("data-secret")).toBe(true);
    await click(button(container, "Show"));
    expect(field(container)?.hasAttribute("data-secret")).toBe(false);
    await click(button(container, "Hide"));
    expect(field(container)?.hasAttribute("data-secret")).toBe(true);
  });

  it.each([
    { name: "left as it is", turnOff: false, want: true },
    { name: "the person turns Keep hidden off", turnOff: true, want: false },
  ])(
    "a secret is stored sensitive unless the person chooses otherwise: $name",
    async ({ turnOff, want }) => {
      const { container, saves } = await mount(ask({ sensitive: false }));
      if (turnOff) await click(keepHidden(container));
      await type(container, "v4lue");
      await click(button(container, "Save to vault"));
      expect(saves.map((each) => each.write.kind === "add" && each.write.sensitive)).toEqual([
        want,
      ]);
    },
  );

  it("a secret the vault holds stays secret: the person cannot make it plain here", async () => {
    const { container, saves } = await mount(ask({ key: "LEGACY_TOKEN", sensitive: false }));
    expect(keepHidden(container)?.getAttribute("aria-checked")).toBe("true");
    expect(keepHidden(container)?.hasAttribute("data-disabled")).toBe(true);
    await type(container, "v4lue");
    await click(button(container, "Save to vault"));
    expect(saves.map((each) => each.write.kind === "update" && each.write.sensitive)).toEqual([
      true,
    ]);
  });

  it("Save to vault writes the value as the person's vault write and keeps it nowhere else", async () => {
    const value = ["sk", "_test_", "Qz".repeat(12)].join("");
    const { container, saves } = await mount(ask());
    await type(container, value);
    await click(button(container, "Save to vault"));
    expect(saves).toEqual([
      {
        scope: { kind: "shared" },
        write: { kind: "add", key: "NEW_STRIPE_KEY", value, sensitive: true },
      },
    ]);
    expect(field(container)?.value).toBe("");
    expect(container.innerHTML).not.toContain(value);
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain(value);
  });

  it("a key the vault holds since before it was asked is updated, its flag sent", async () => {
    const { container, saves } = await mount(ask({ key: "LOG_LEVEL", sensitive: false }));
    await click(keepHidden(container));
    await type(container, "info");
    await click(button(container, "Save to vault"));
    expect(saves.map((each) => each.write)).toEqual([
      { kind: "update", id: "v-log", key: "LOG_LEVEL", value: "info", sensitive: false },
    ]);
  });

  it("a service's own vault is written by its id", async () => {
    const { container, saves } = await mount(
      ask({ key: "MAIL_FROM", scope: { kind: "service", hostname: "appdev" } }),
    );
    await type(container, "hi@acme.dev");
    await click(button(container, "Save to vault"));
    expect(saves.map((each) => each.scope)).toEqual([{ kind: "service", serviceId: "svc-appdev" }]);
  });

  it("a refused save stands in the drawer in Zerops' words, the value kept to try again", async () => {
    const { container } = await mount(ask(), {
      density: "compact",
      answer: { ok: false, code: "projectEnvDuplicateKey", message: "The key exists already." },
    });
    await type(container, "v4lue");
    await click(button(container, "Save to vault"));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("The key exists already.");
    expect(field(container)?.value).toBe("v4lue");
  });

  it("a refusal stands inline and the card stays open to try again", async () => {
    const { container, saves } = await mount(ask(), {
      answer: { ok: false, code: "projectEnvDuplicateKey", message: "The key exists already." },
    });
    await type(container, "v4lue");
    await click(button(container, "Save to vault"));
    expect(field(container)).not.toBeNull();
    await click(button(container, "Try again"));
    expect(saves.map((each) => each.write.kind === "add" && each.write.value)).toEqual([
      "v4lue",
      "v4lue",
    ]);
  });

  it("an app's own value says it goes to that app's vault", async () => {
    const { container } = await mount(
      ask({ key: "MAIL_FROM", scope: { kind: "service", hostname: "appdev" } }),
    );
    expect(container.querySelector("[data-ask-id]")?.getAttribute("aria-label")).toBe(
      "Add MAIL_FROM to appdev's vault",
    );
    expect(container.textContent).toContain("This Mate · appdev");
  });

  it("a value added in the Vault since it was asked is offered as the answer", async () => {
    const { container, said } = await mount(ask({ key: "STRIPE_SECRET_KEY" }));
    expect(container.querySelector("[data-vault-ask-given]")?.textContent).toBe(
      "Added in the Vault since Milo asked · hidden",
    );
    expect(field(container)).toBeNull();
    await click(button(container, "Use that one"));
    expect(said).toEqual(["use-given"]);
  });

  it("a name the Mate keeps for itself takes no value: the card says why and offers Not now", async () => {
    const { container, saves, said } = await mount(ask({ key: "MATE_PROBE_TOKEN" }));
    expect(field(container)).toBeNull();
    expect(button(container, "Save to vault")).toBeUndefined();
    expect(footer(container)?.textContent).toBe(
      "MATE_PROBE_TOKEN is a name Milo keeps for itself, so the vault won't list it.Not now",
    );
    expect(container.querySelector("[data-vault-ask-warning]")).toBeNull();
    await click(button(container, "Not now"));
    expect(said).toEqual(["not-now"]);
    expect(saves).toEqual([]);
  });

  it("a service no longer in the project takes no value", async () => {
    const { container } = await mount(ask({ scope: { kind: "service", hostname: "gone" } }));
    expect(field(container)).toBeNull();
    expect(container.textContent).toContain("gone isn't in this project any more.");
  });

  it("a key named like a Zerops sign-in is warned of before it is given", async () => {
    const { container } = await mount(ask({ key: "ZEROPS_TOKEN", label: "Zerops token" }));
    expect(container.querySelector("[data-vault-ask-warning]")?.textContent).toBe(
      "Looks like a Zerops sign-in. Milo never needs yours.",
    );
  });

  it("a press under way holds the card's presses until the record answers", async () => {
    const { container } = await mount(ask(), { pending: "notNow" });
    expect(button(container, "Save to vault")?.disabled).toBe(true);
    expect(button(container, "Not now")?.disabled).toBe(true);
    expect(field(container)?.disabled).toBe(true);
  });
});

describe("the ask card reads what the person said from the engine's record", () => {
  it.each([
    {
      name: "saved: where the value is, who set it, and what the Mate hears",
      asked: ask({ key: "STRIPE_SECRET_KEY" }),
      record: { state: "saved", answer: { by: ana, at: VAULT_FIXTURE_NOW } } as const,
      want: "In Milo's vault · hidden · set by AlešMilo hears: STRIPE_SECRET_KEY is saved for every app",
    },
    {
      name: "Not now: who said it and when",
      asked: ask(),
      record: { state: "declined", answer: { by: ana, at: VAULT_FIXTURE_NOW } } as const,
      want: "Not now · Aleš, 15:04",
    },
  ])("$name", async ({ asked, record, want }) => {
    const { container } = await mount(asked, { record });
    expect(footer(container)?.textContent).toBe(want);
    expect(field(container)).toBeNull();
    expect(button(container, "Not now")).toBeUndefined();
  });
});

describe("the ask above the composer", () => {
  it("is the same ask, compact, with Show in conversation to its card", async () => {
    const { container, said, saves } = await mount(ask(), { density: "compact" });
    const card = container.querySelector('[data-ask-density="compact"]');
    expect(card?.getAttribute("data-composer-top")).toBe("vault");
    expect(field(container)?.getAttribute("aria-label")).toBe("Stripe secret key");
    await click(button(container, "Show in conversation"));
    expect(said).toEqual(["show"]);
    await type(container, "v4lue");
    await click(button(container, "Save to vault"));
    expect(saves).toHaveLength(1);
  });
});
