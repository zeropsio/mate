// @vitest-environment happy-dom
import type {
  VaultAskActivityPayload,
  VaultScopeRef,
  VaultWrite,
} from "@t3tools/client-runtime/data";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { VaultWriteOutcome } from "./VaultPanel";
import { VaultRequestCard } from "./VaultRequestCard";
import { VAULT_FIXTURE, VAULT_FIXTURE_NOW } from "./vaultFixture";
import {
  type VaultAsk,
  type VaultAskSaid,
  vaultAskPickUp,
  vaultAskState,
} from "./vaultRequest.logic";

let root: Root | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const ask = (over: Partial<VaultAsk> = {}): VaultAsk => ({
  key: "OPENAI_API_KEY",
  scope: { kind: "shared" },
  sensitive: true,
  reason: "The chat feature calls OpenAI — platform.openai.com › API keys.",
  askedAt: new Date(VAULT_FIXTURE_NOW - 5 * 60_000).toISOString(),
  ...over,
});

interface Mounted {
  readonly container: HTMLElement;
  readonly puts: Array<{ scope: VaultScopeRef; write: VaultWrite }>;
}

/** The card as its container draws it: what the person said is kept, a put that lands is said. */
async function mount(
  asked: VaultAsk,
  answer: VaultWriteOutcome = { ok: true },
  said: VaultAskSaid | null = null,
  engine: VaultAskActivityPayload["state"] | null = null,
): Promise<Mounted> {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const puts: Mounted["puts"] = [];
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  function Harness() {
    const [saying, setSaying] = useState<VaultAskSaid | null>(said);
    return (
      <VaultRequestCard
        ask={asked}
        mateName="Fen"
        onNotNow={() => setSaying("not-now")}
        onPut={async (scope, write) => {
          puts.push({ scope, write });
          if (answer.ok) setSaying("put");
          return answer;
        }}
        said={saying}
        engine={engine}
        pickUp={vaultAskPickUp(VAULT_FIXTURE, asked)}
        state={vaultAskState(VAULT_FIXTURE, asked)}
      />
    );
  }
  await act(async () => root!.render(<Harness />));
  return { container, puts };
}

const field = (container: Element) =>
  container.querySelector<HTMLInputElement>(
    'input[aria-label="Paste it here — it goes to the vault, not the chat"]',
  );
const button = (container: Element, words: string) =>
  [...container.querySelectorAll("button")].find(
    (candidate) =>
      candidate.textContent?.trim() === words || candidate.getAttribute("aria-label") === words,
  ) as HTMLButtonElement | undefined;

async function type(container: Element, text: string) {
  const input = field(container)!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const secretBox = (container: Element) =>
  container.querySelector<HTMLElement>('[role="checkbox"]') ?? undefined;

async function click(target: HTMLElement | undefined) {
  await act(async () => target!.click());
}

describe("VaultRequestCard — asking for a value", () => {
  it("says who needs what, where it goes and why, behind a password field", async () => {
    const { container } = await mount(ask());
    expect(container.textContent).toContain("Fen needs OPENAI_API_KEY");
    expect(container.querySelector("[data-vault-request-where]")?.textContent).toBe("Shared");
    expect(container.textContent).toContain("platform.openai.com › API keys.");
    expect(field(container)?.type).toBe("password");
    expect(button(container, "Put in vault")?.disabled).toBe(true);
    expect(button(container, "Not now")).toBeDefined();
  });

  it("the field is masked until the person shows it, whatever the agent asked", async () => {
    const { container } = await mount(
      ask({ key: "MAIL_FROM", scope: { kind: "service", hostname: "appdev" }, sensitive: false }),
    );
    expect(container.querySelector("[data-vault-request-where]")?.textContent).toBe("appdev");
    expect(field(container)?.type).toBe("password");
    expect(field(container)?.getAttribute("autocomplete")).toBe("new-password");
    await click(button(container, "Show"));
    expect(field(container)?.type).toBe("text");
    await click(button(container, "Hide"));
    expect(field(container)?.type).toBe("password");
  });

  it.each([
    { name: "asked secret, left as it is", sensitive: true, untick: false, want: true },
    { name: "asked secret, made plain by the person", sensitive: true, untick: true, want: false },
    {
      name: "asked plain, left as the agent pre-selected",
      sensitive: false,
      untick: false,
      want: false,
    },
  ])(
    "a secret is stored sensitive unless the person chooses otherwise: $name",
    async ({ sensitive, untick, want }) => {
      const { container, puts } = await mount(ask({ key: "NEW_KEY", sensitive }));
      expect(secretBox(container)?.getAttribute("aria-checked")).toBe(String(sensitive));
      if (untick) await click(secretBox(container));
      await type(container, "v4lue");
      await click(button(container, "Put in vault"));
      expect(puts.map((each) => each.write.kind === "add" && each.write.sensitive)).toEqual([want]);
    },
  );

  it("a secret the vault holds stays secret: the person cannot make it plain here", async () => {
    const { container, puts } = await mount(
      ask({ key: "LEGACY_TOKEN", sensitive: false }),
      undefined,
      null,
      "open",
    );
    expect(secretBox(container)?.getAttribute("aria-checked")).toBe("true");
    expect(secretBox(container)?.hasAttribute("data-disabled")).toBe(true);
    await type(container, "v4lue");
    await click(button(container, "Save"));
    expect(puts.map((each) => each.write.kind === "update" && each.write.sensitive)).toEqual([
      true,
    ]);
  });

  it("the Mate's reason reads as its words, beside who can read it and what never goes in", async () => {
    const { container } = await mount(ask());
    expect(container.querySelector("[data-vault-request-reason]")?.textContent).toBe(
      "Fen: The chat feature calls OpenAI — platform.openai.com › API keys.",
    );
    expect(container.querySelector("[data-vault-request-reason] q")).not.toBeNull();
    expect(container.querySelector("[data-vault-request-reach]")?.textContent).toBe(
      "Every app in this project can read it, Fen included. Never paste your own password or Zerops token.",
    );
    expect(container.querySelector("[data-vault-request-own]")).toBeNull();
  });

  it("a key named like a Zerops sign-in is warned of before it is given", async () => {
    const { container } = await mount(
      ask({ key: "ZEROPS_TOKEN", reason: "From Settings, Access tokens." }),
    );
    expect(container.querySelector("[data-vault-request-own]")?.textContent).toBe(
      "ZEROPS_TOKEN looks like a Zerops sign-in. Fen never needs yours.",
    );
  });

  it("puts a new key in as an add, folds to one line, and keeps the value nowhere", async () => {
    const { container, puts } = await mount(ask());
    await type(container, "sk-test-123");
    await click(button(container, "Put in vault"));
    expect(puts).toEqual([
      {
        scope: { kind: "shared" },
        write: { kind: "add", key: "OPENAI_API_KEY", value: "sk-test-123", sensitive: true },
      },
    ]);
    expect(field(container)).toBeNull();
    expect(container.textContent).toBe(
      "OPENAI_API_KEY is in the vault — Fen hears it with your next message",
    );
    expect(container.innerHTML).not.toContain("sk-test-123");
  });

  it("a key the vault holds since before it was asked is updated, its flag sent", async () => {
    const { container, puts } = await mount(ask({ key: "LOG_LEVEL", sensitive: false }));
    await type(container, "info");
    await click(button(container, "Put in vault"));
    expect(puts.map((each) => each.write)).toEqual([
      { kind: "update", id: "v-log", key: "LOG_LEVEL", value: "info", sensitive: false },
    ]);
  });

  it("a service's own vault is written by its id", async () => {
    const { container, puts } = await mount(
      ask({ key: "MAIL_FROM", scope: { kind: "service", hostname: "appdev" } }),
    );
    await type(container, "hi@acme.dev");
    await click(button(container, "Put in vault"));
    expect(puts.map((each) => each.scope)).toEqual([{ kind: "service", serviceId: "svc-appdev" }]);
  });

  it("a refusal stands inline and the card stays open to try again", async () => {
    const { container } = await mount(ask(), {
      ok: false,
      code: "projectEnvDuplicateKey",
      message: "The key exists already.",
    });
    await type(container, "sk-test-123");
    await click(button(container, "Put in vault"));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("The key exists already.");
    expect(field(container)).not.toBeNull();
  });

  it("Not now folds it to one line", async () => {
    const { container, puts } = await mount(ask());
    await click(button(container, "Not now"));
    expect(container.textContent).toBe("Fen asked for OPENAI_API_KEY · Not now");
    expect(puts).toEqual([]);
  });

  it("given since it was asked, it reads as in the vault", async () => {
    const { container } = await mount(ask({ key: "STRIPE_SECRET_KEY" }));
    expect(container.textContent).toBe("STRIPE_SECRET_KEY is in the vault");
  });

  it("a service no longer in the project takes no value", async () => {
    const { container } = await mount(ask({ scope: { kind: "service", hostname: "gone" } }));
    expect(field(container)).toBeNull();
    expect(container.textContent).toContain("gone is not in this project any more.");
  });
});

describe("VaultRequestCard — an ask the engine keeps", () => {
  it("names the key, why, where it goes and what makes it take effect, behind Save and Decline", async () => {
    const { container } = await mount(ask(), { ok: true }, null, "open");
    expect(container.textContent).toContain("Fen needs OPENAI_API_KEY");
    expect(container.querySelector("[data-vault-request-where]")?.textContent).toBe("Shared");
    expect(container.textContent).toContain("platform.openai.com › API keys.");
    expect(container.querySelector("[data-vault-request-pickup]")?.textContent).toBe(
      "It takes effect once a service's zerops.yaml references it and that service is deployed.",
    );
    expect(field(container)?.getAttribute("autocomplete")).toBe("new-password");
    expect(field(container)?.type).toBe("password");
    expect(button(container, "Save")?.disabled).toBe(true);
    expect(button(container, "Decline")).toBeDefined();
  });

  it("Save writes the value to the vault and keeps it nowhere: the card says the Mate was told", async () => {
    const { container, puts } = await mount(ask(), { ok: true }, null, "open");
    await type(container, "sk-test-123");
    await click(button(container, "Save"));
    expect(puts).toEqual([
      {
        scope: { kind: "shared" },
        write: { kind: "add", key: "OPENAI_API_KEY", value: "sk-test-123", sensitive: true },
      },
    ]);
    expect(field(container)).toBeNull();
    expect(container.textContent).toContain("OPENAI_API_KEY is in the vault — Fen has been told");
    expect(container.innerHTML).not.toContain("sk-test-123");
    expect(JSON.stringify({ ...localStorage })).not.toContain("sk-test-123");
    expect(JSON.stringify({ ...sessionStorage })).not.toContain("sk-test-123");
  });

  it("Decline folds it to one line and writes nothing", async () => {
    const { container, puts } = await mount(ask(), { ok: true }, null, "open");
    await click(button(container, "Decline"));
    expect(container.textContent).toBe("Fen asked for OPENAI_API_KEY · Declined");
    expect(puts).toEqual([]);
  });

  it.each([
    ["saved", "OPENAI_API_KEY is in the vault — Fen has been told"],
    ["declined", "Fen asked for OPENAI_API_KEY · Declined"],
  ] as const)("the engine's record %s draws it so after a reload", async (engine, words) => {
    const { container } = await mount(ask(), { ok: true }, null, engine);
    expect(container.textContent).toContain(words);
    expect(field(container)).toBeNull();
  });
});
