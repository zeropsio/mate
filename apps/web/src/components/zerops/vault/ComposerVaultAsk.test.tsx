// @vitest-environment happy-dom
import type { VaultScopeRef, VaultWrite } from "@t3tools/client-runtime/data";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { ComposerVaultAsk } from "./ComposerVaultAsk";
import type { VaultWriteOutcome } from "./VaultPanel";
import { VAULT_FIXTURE, VAULT_FIXTURE_NOW } from "./vaultFixture";
import { type VaultAsk, vaultAskState } from "./vaultRequest.logic";

let root: Root | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const ask = (over: Partial<VaultAsk> = {}): VaultAsk => ({
  key: "NEW_STRIPE_KEY",
  label: "Stripe secret key",
  scope: { kind: "shared" },
  sensitive: true,
  reason: "for the questionnaire API",
  askedAt: new Date(VAULT_FIXTURE_NOW - 5 * 60_000).toISOString(),
  ...over,
});

interface Mounted {
  readonly container: HTMLElement;
  readonly saves: Array<{ scope: VaultScopeRef; write: VaultWrite }>;
  readonly said: Array<"not-now" | "use-given">;
}

async function mount(asked: VaultAsk, answer: VaultWriteOutcome = { ok: true }): Promise<Mounted> {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const saves: Mounted["saves"] = [];
  const said: Mounted["said"] = [];
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(
      <ComposerVaultAsk
        ask={asked}
        mateName="Milo"
        onNotNow={() => said.push("not-now")}
        onSave={async (scope, write) => {
          saves.push({ scope, write });
          return answer;
        }}
        onUseGiven={() => said.push("use-given")}
        state={vaultAskState(VAULT_FIXTURE, asked)}
      />,
    ),
  );
  return { container, saves, said };
}

const field = (container: Element) =>
  container.querySelector<HTMLInputElement>('input[aria-label^="Your "]');
const button = (container: Element, words: string) =>
  [...container.querySelectorAll("button")].find(
    (candidate) =>
      candidate.textContent?.trim() === words || candidate.getAttribute("aria-label") === words,
  ) as HTMLButtonElement | undefined;
const hiddenSwitch = (container: Element) =>
  container.querySelector<HTMLElement>('[role="switch"]') ?? undefined;
const text = (container: Element, part: string) =>
  container.querySelector(`[data-vault-ask-${part}]`)?.textContent ?? null;

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

describe("the composer's drawer asks for a value", () => {
  it("says in one line what the Mate needs and why, behind a masked field, Keep hidden on, Save to vault and Not now", async () => {
    const { container } = await mount(ask());
    expect(text(container, "line")).toBe(
      "Milo needs your Stripe secret key, for the questionnaire API",
    );
    expect(text(container, "note")).toBe(
      "Goes to this project's vault for every app, never into this chat.",
    );
    expect(field(container)?.hasAttribute("data-secret")).toBe(true);
    expect(field(container)?.getAttribute("autocomplete")).toBe("off");
    expect(hiddenSwitch(container)?.getAttribute("aria-checked")).toBe("true");
    expect(button(container, "Save to vault")?.disabled).toBe(true);
    expect(button(container, "Not now")).toBeDefined();
    expect(text(container, "warning")).toBeNull();
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
      if (turnOff) await click(hiddenSwitch(container));
      await type(container, "v4lue");
      await click(button(container, "Save to vault"));
      expect(saves.map((each) => each.write.kind === "add" && each.write.sensitive)).toEqual([
        want,
      ]);
    },
  );

  it("a secret the vault holds stays secret: the person cannot make it plain here", async () => {
    const { container, saves } = await mount(ask({ key: "LEGACY_TOKEN", sensitive: false }));
    expect(hiddenSwitch(container)?.getAttribute("aria-checked")).toBe("true");
    expect(hiddenSwitch(container)?.hasAttribute("data-disabled")).toBe(true);
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

  it("a refused save stands in the drawer in Zerops' words, the value kept to try again", async () => {
    const { container } = await mount(ask(), {
      ok: false,
      code: "projectEnvDuplicateKey",
      message: "The key exists already.",
    });
    await type(container, "v4lue");
    await click(button(container, "Save to vault"));
    expect(text(container, "refusal")).toBe("The key exists already.");
    expect(field(container)?.value).toBe("v4lue");
  });

  it("an app's own value says it goes to that app's vault", async () => {
    const { container } = await mount(
      ask({ key: "MAIL_FROM", scope: { kind: "service", hostname: "appdev" } }),
    );
    expect(text(container, "note")).toBe("Goes to appdev's vault, never into this chat.");
  });

  it("a value added in the Vault since it was asked is offered as the answer", async () => {
    const { container, said } = await mount(ask({ key: "STRIPE_SECRET_KEY" }));
    expect(text(container, "note")).toBe("You added it in the Vault.");
    expect(field(container)).toBeNull();
    await click(button(container, "Use that one"));
    expect(said).toEqual(["use-given"]);
  });

  it("a name the Mate keeps for itself takes no value: the card says why and offers Decline", async () => {
    const { container, saves, said } = await mount(ask({ key: "MATE_PROBE_TOKEN" }));
    expect(field(container)).toBeNull();
    expect(text(container, "note")).toBe(
      "MATE_PROBE_TOKEN is a name Milo keeps for itself, so the vault won't list it.",
    );
    expect(text(container, "warning")).toBeNull();
    await click(button(container, "Not now"));
    expect(said).toEqual(["not-now"]);
    expect(saves).toEqual([]);
  });

  it("a key named like a Zerops sign-in is warned of before it is given", async () => {
    const { container } = await mount(ask({ key: "ZEROPS_TOKEN", label: "Zerops token" }));
    expect(text(container, "warning")).toBe("Looks like a Zerops sign-in. Milo never needs yours.");
  });
});
