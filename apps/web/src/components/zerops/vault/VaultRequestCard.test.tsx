// @vitest-environment happy-dom
import type { VaultScopeRef, VaultWrite } from "@t3tools/client-runtime/data";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { VaultWriteOutcome } from "./VaultPanel";
import { VaultRequestCard } from "./VaultRequestCard";
import { VAULT_FIXTURE, VAULT_FIXTURE_NOW } from "./vaultFixture";
import { type VaultAsk, type VaultAskSaid, vaultAskState } from "./vaultRequest.logic";

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
    (candidate) => candidate.textContent?.trim() === words,
  ) as HTMLButtonElement | undefined;

async function type(container: Element, text: string) {
  const input = field(container)!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function click(target: HTMLElement | undefined) {
  await act(async () => target!.click());
}

describe("VaultRequestCard — asking for a value", () => {
  it("says who needs what, where it goes and why, behind a password field", async () => {
    const { container } = await mount(ask());
    expect(container.textContent).toContain("Fen needs OPENAI_API_KEY");
    expect(container.textContent).toContain("Shared · sensitive");
    expect(container.textContent).toContain("platform.openai.com › API keys.");
    expect(field(container)?.type).toBe("password");
    expect(button(container, "Put in vault")?.disabled).toBe(true);
    expect(button(container, "Not now")).toBeDefined();
  });

  it("a plain value of a service's own is typed in the open", async () => {
    const { container } = await mount(
      ask({ key: "MAIL_FROM", scope: { kind: "service", hostname: "appdev" }, sensitive: false }),
    );
    expect(container.textContent).toContain("appdev · plain");
    expect(field(container)?.type).toBe("text");
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
