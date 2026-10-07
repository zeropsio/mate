// @vitest-environment happy-dom
import type { VaultScopeRef, VaultView, VaultWrite } from "@t3tools/client-runtime/data";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { VaultPanelBody, type VaultPanelBodyProps, type VaultPending } from "./VaultPanel";
import { VAULT_FIXTURE, VAULT_FIXTURE_NOW, vaultFixtureImpact } from "./vaultFixture";

let root: Root | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

interface Mounted {
  readonly container: HTMLElement;
  readonly writes: Array<{ scope: VaultScopeRef; write: VaultWrite }>;
  readonly restarts: Array<string>;
  readonly rerender: (over: Partial<VaultPanelBodyProps>) => Promise<void>;
}

async function mount(over: Partial<VaultPanelBodyProps> = {}): Promise<Mounted> {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const writes: Mounted["writes"] = [];
  const restarts: Array<string> = [];
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  let props: VaultPanelBodyProps = {
    view: VAULT_FIXTURE,
    actor: "mate",
    who: { kind: "mate", name: "Fen", tint: "olive" },
    pending: new Map(),
    restarting: new Set(),
    impactOf: (scope, write) => vaultFixtureImpact(VAULT_FIXTURE, scope, write),
    onWrite: async (scope, write) => {
      writes.push({ scope, write });
      return { ok: true };
    },
    onRestart: async (serviceId) => {
      restarts.push(serviceId);
    },
    nowMs: VAULT_FIXTURE_NOW,
    ...over,
  };
  await act(async () => root!.render(<VaultPanelBody {...props} />));
  return {
    container,
    writes,
    restarts,
    rerender: async (next) => {
      props = { ...props, ...next };
      await act(async () => root!.render(<VaultPanelBody {...props} />));
    },
  };
}

const q = <T extends Element = HTMLElement>(container: Element, selector: string) =>
  container.querySelector(selector) as T | null;
const rowKeys = (container: Element, section: string) =>
  [...container.querySelectorAll(`[data-vault-section="${section}"] [data-vault-row]`)].map((row) =>
    row.getAttribute("data-vault-row"),
  );
const button = (container: Element, words: string) => {
  const found = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === words,
  );
  if (found === undefined) throw new Error(`No button "${words}"`);
  return found as HTMLButtonElement;
};
const click = (element: Element | null) =>
  act(async () => {
    (element as HTMLElement).click();
  });
const typeInto = (element: Element | null, value: string) =>
  act(async () => {
    const field = element as HTMLInputElement | HTMLTextAreaElement;
    // React tracks the value on the element; the prototype's own setter goes around it.
    let prototype = Object.getPrototypeOf(field) as object | null;
    while (
      prototype !== null &&
      Object.getOwnPropertyDescriptor(prototype, "value") === undefined
    ) {
      prototype = Object.getPrototypeOf(prototype) as object | null;
    }
    Object.getOwnPropertyDescriptor(prototype ?? {}, "value")?.set?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
const openRow = (container: Element, key: string) =>
  click(q(container, `[data-vault-row="${key}"] > button`));

describe("VaultPanelBody — what the Vault tab shows", () => {
  it("draws the Mate, the scopes with their counts, and Shared's values plain then sensitive", async () => {
    const { container } = await mount();
    expect(q(container, "[data-vault-header]")?.textContent).toContain("Fen");
    expect([...container.querySelectorAll("[role=tab]")].map((tab) => tab.textContent)).toEqual([
      "Shared5",
      "appdev1",
      "appstage",
      "db",
    ]);
    expect(q(container, "[role=tab][aria-selected=true]")?.textContent).toBe("Shared5");
    expect(rowKeys(container, "plain")).toEqual(["API_URL", "LOG_LEVEL"]);
    expect(rowKeys(container, "sensitive")).toEqual([
      "LEGACY_TOKEN",
      "SESSION_SECRET",
      "STRIPE_SECRET_KEY",
    ]);
    expect(q(container, '[data-vault-row="API_URL"]')?.textContent).toContain(
      "https://api.acme.dev",
    );
    expect(q(container, '[data-vault-row="SESSION_SECRET"]')?.textContent).toContain(
      "Sensitive · set 2 days ago",
    );
    expect(q(container, '[data-vault-row="STRIPE_SECRET_KEY"]')?.textContent).toContain(
      "Added just now · nothing reads it yet",
    );
  });

  it("marks who reads a value, and which of them runs the previous one", async () => {
    const { container } = await mount();
    const marks = (key: string) =>
      [
        ...container.querySelectorAll(`[data-vault-row="${key}"] [data-vault-marks] .vault-mark`),
      ].map((mark) => `${mark.textContent}${mark.hasAttribute("data-restart") ? "!" : ""}`);
    expect(marks("API_URL")).toEqual(["D", "S"]);
    expect(marks("LOG_LEVEL")).toEqual(["D!"]);
    expect(marks("STRIPE_SECRET_KEY")).toEqual([]);
  });

  it("says what is not live yet, and beside a Mate who makes it live", async () => {
    const { container } = await mount();
    const block = q(container, "[data-vault-notlive]");
    expect(
      [...block!.querySelectorAll("[data-vault-notlive-item]")].map((item) => item.textContent),
    ).toEqual([
      "appdev started before LOG_LEVEL changed — a restart applies it",
      "Nothing reads STRIPE_SECRET_KEY yet — it needs a reference in zerops.yml and a deploy",
      "appdev reads ${NOPE}, which nothing has — the app gets that literal text",
      "appdev's zerops.yml sets DB_PASSWORD to ${DB_PASSWORD} — the app gets that literal text",
    ]);
    expect(block?.textContent).toContain("Fen does these with your next message");
    expect(block?.textContent).not.toContain("Restart appdev");
  });

  it("draws no block when everything is live", async () => {
    const { container } = await mount({ view: { ...VAULT_FIXTURE, notLive: [] } });
    expect(q(container, "[data-vault-notlive]")).toBeNull();
  });

  it("opens the row an item names, and a service's yaml item shows its scope", async () => {
    const { container } = await mount();
    await click(q(container, '[data-vault-notlive-item="unread:shared:STRIPE_SECRET_KEY"]'));
    expect(
      q(container, '[data-vault-row="STRIPE_SECRET_KEY"] > button')?.getAttribute("aria-expanded"),
    ).toBe("true");
    await click(q(container, '[data-vault-notlive-item="missing:svc-appdev:SEARCH_URL"]'));
    expect(q(container, "[role=tab][aria-selected=true]")?.textContent).toBe("appdev1");
    expect(q(container, '[data-vault-reads="appdev"]')).not.toBeNull();
  });

  it("without a Mate, restarts a service once the person confirms", async () => {
    const { container, restarts } = await mount({
      actor: "environment",
      who: { kind: "environment", name: "prod" },
    });
    expect(q(container, "[data-vault-notlive]")?.textContent).not.toContain("next message");
    await click(button(container, "Restart appdev"));
    expect(restarts).toEqual([]);
    expect(q(container, '[role=alertdialog][aria-label="Restart appdev"]')?.textContent).toContain(
      "appdev restarts now. Its containers restart one by one.",
    );
    await click(button(container, "Restart"));
    expect(restarts).toEqual(["svc-appdev"]);
  });
});

describe("VaultPanelBody — a row opens in place", () => {
  it("saves a new plain value, then says who runs the previous one", async () => {
    const { container, writes } = await mount();
    await openRow(container, "API_URL");
    const body = q(container, '[data-vault-body="API_URL"]')!;
    expect(body.textContent).toContain("Read by");
    expect(body.textContent).toContain("Used as ${API_URL}");
    await typeInto(body.querySelector('input[aria-label="API_URL"]'), "https://api.acme.shop");
    await click(button(body, "Save"));
    expect(writes).toEqual([
      {
        scope: { kind: "shared" },
        write: {
          kind: "update",
          id: "v-api",
          key: "API_URL",
          value: "https://api.acme.shop",
          sensitive: false,
        },
      },
    ]);
    expect(q(container, '[data-vault-row="API_URL"] [data-vault-impact]')?.textContent).toBe(
      "appdev and appstage read it · a restart applies it",
    );
  });

  it("never shows a sensitive value: its field starts empty and replaces it", async () => {
    const { container, writes } = await mount();
    await openRow(container, "SESSION_SECRET");
    const field = q<HTMLInputElement>(
      container,
      '[data-vault-body="SESSION_SECRET"] input[aria-label="SESSION_SECRET"]',
    )!;
    expect(field.value).toBe("");
    expect(field.type).toBe("password");
    expect(container.textContent).not.toContain("Make sensitive");
    await typeInto(field, "s3cret");
    await click(button(q(container, '[data-vault-body="SESSION_SECRET"]')!, "Save"));
    expect(writes[0]?.write).toEqual({
      kind: "update",
      id: "v-session",
      key: "SESSION_SECRET",
      value: "s3cret",
      sensitive: true,
    });
  });

  it("makes a plain value sensitive with the same value", async () => {
    const { container, writes } = await mount();
    await openRow(container, "LOG_LEVEL");
    await click(button(container, "Make sensitive"));
    expect(writes[0]?.write).toEqual({
      kind: "update",
      id: "v-log",
      key: "LOG_LEVEL",
      value: "debug",
      sensitive: true,
    });
  });

  it("guards a removal that services read until the person says remove anyway", async () => {
    const { container, writes } = await mount();
    await openRow(container, "SESSION_SECRET");
    await click(button(container, "Remove"));
    expect(writes).toEqual([]);
    expect(q(container, "[role=alertdialog]")?.textContent).toContain(
      "appdev and appstage read SESSION_SECRET. After their next restart they'd get the literal text ${SESSION_SECRET}.",
    );
    await click(button(container, "Remove anyway"));
    expect(writes[0]?.write).toEqual({ kind: "remove", id: "v-session", key: "SESSION_SECRET" });
  });

  it("removes a value nothing reads at once", async () => {
    const { container, writes } = await mount();
    await openRow(container, "STRIPE_SECRET_KEY");
    await click(button(container, "Remove"));
    expect(writes[0]?.write).toEqual({
      kind: "remove",
      id: "v-stripe",
      key: "STRIPE_SECRET_KEY",
    });
  });

  it("shows a refused write's reason on its row", async () => {
    const { container } = await mount({
      onWrite: async () => ({ ok: false, code: "projectEnvKeyInvalid", message: null }),
    });
    await openRow(container, "LOG_LEVEL");
    await click(button(container, "Make sensitive"));
    expect(q(container, '[data-vault-row="LOG_LEVEL"] [role=alert]')?.textContent).toBe(
      "Letters, digits and _ only, not starting with a digit",
    );
  });

  it("shows a spinner where the marks are while the account writes a row", async () => {
    const pending = new Map<string, VaultPending>([["shared:API_URL", { kind: "saving" }]]);
    const { container } = await mount({ pending });
    const row = q(container, '[data-vault-row="API_URL"]')!;
    expect(row.querySelector("[role=status]")).not.toBeNull();
    expect(row.querySelector("[data-vault-marks]")).toBeNull();
  });
});

describe("VaultPanelBody — adding", () => {
  it("turns Sensitive on for a secret-sounding name, and adds", async () => {
    const { container, writes } = await mount();
    await click(button(container, "Add"));
    const add = q(container, "[data-vault-add]")!;
    expect(add.textContent).toContain("New value in Shared");
    await typeInto(add.querySelector('input[aria-label="Key"]'), "GITHUB_TOKEN");
    expect(add.querySelector("[role=switch]")?.getAttribute("aria-checked")).toBe("true");
    expect(add.querySelector("[data-vault-add-auto]")?.textContent).toBe(
      "on because the name holds TOKEN",
    );
    await typeInto(add.querySelector('input[aria-label="Value"]'), "ghp_x");
    await click(button(add, "Save"));
    expect(writes[0]).toEqual({
      scope: { kind: "shared" },
      write: { kind: "add", key: "GITHUB_TOKEN", value: "ghp_x", sensitive: true },
    });
  });

  it.each([
    ["shared", "api_url", "API_URL is already in Shared"],
    ["shared", "bad-key!", "Letters, digits and _ only, not starting with a digit"],
    ["svc-appdev", "NODE_ENV", "appdev's zerops.yml already sets NODE_ENV"],
  ])("in %s refuses %s inline", async (scopeId, key, words) => {
    const { container, writes } = await mount();
    await click(q(container, `[data-vault-scope="${scopeId}"]`));
    await click(button(container, "Add"));
    const add = q(container, "[data-vault-add]")!;
    await typeInto(add.querySelector('input[aria-label="Key"]'), key);
    expect(add.querySelector("[data-vault-add-error]")?.textContent).toBe(words);
    expect(button(add, "Save").disabled).toBe(true);
    expect(writes).toEqual([]);
  });
});

describe("VaultPanelBody — scopes", () => {
  it("shows what a service reads and where each comes from", async () => {
    const { container } = await mount();
    await click(q(container, '[data-vault-scope="svc-appdev"]'));
    const reads = q(container, '[data-vault-reads="appdev"]')!;
    const line = (key: string) => reads.querySelector(`[data-vault-read="${key}"]`)?.textContent;
    expect(line("NODE_ENV")).toBe("NODE_ENV= development");
    expect(line("API_URL")).toBe("API_URL← Shared");
    expect(line("FEATURE_FLAGS")).toBe("FEATURE_FLAGS← own");
    expect(line("DATABASE_URL")).toBe("DATABASE_URL← db");
    expect(line("PUBLIC_HOST")).toBe("PUBLIC_HOST← platform");
    expect(line("SEARCH_URL")).toBe("SEARCH_URLmissing");
    expect(line("DB_PASSWORD")).toBe("DB_PASSWORDself");
    expect(reads.textContent).toContain("From the deployed zerops.yml");
  });

  it("goes to the value a read comes from", async () => {
    const { container } = await mount();
    await click(q(container, '[data-vault-scope="svc-appdev"]'));
    await click(q(container, '[data-vault-read="LOG_LEVEL"]'));
    expect(q(container, "[role=tab][aria-selected=true]")?.textContent).toBe("Shared5");
    expect(
      q(container, '[data-vault-row="LOG_LEVEL"] > button')?.getAttribute("aria-expanded"),
    ).toBe("true");
  });

  it("draws a managed service's values read only, each with its reference", async () => {
    const { container } = await mount();
    await click(q(container, '[data-vault-scope="svc-db"]'));
    expect(button(container, "Add").disabled).toBe(true);
    expect(button(container, "Edit as text").disabled).toBe(true);
    expect(q(container, '[data-vault-row="password"]')?.textContent).toContain(
      "Sensitive · made by Zerops",
    );
    expect(
      q(container, '[data-vault-row="password"] [data-vault-copy]')?.getAttribute(
        "data-vault-copy",
      ),
    ).toBe("${db_password}");
    expect(q(container, '[data-vault-row="password"] > button')).toBeNull();
  });

  it("says a scope has nothing yet, with Add", async () => {
    const { container } = await mount();
    await click(q(container, '[data-vault-scope="svc-appstage"]'));
    expect(container.textContent).toContain("Nothing in appstage yet.");
    await click(button(container, "Add one"));
    expect(q(container, "[data-vault-add]")?.textContent).toContain("New value in appstage");
  });

  it("filters by key and plain value, and counts the matches per scope", async () => {
    const { container } = await mount();
    await click(q(container, 'button[aria-label="Search"]'));
    await typeInto(q(container, 'input[aria-label="Search keys and values"]'), "secret");
    expect(rowKeys(container, "plain")).toEqual([]);
    expect(rowKeys(container, "sensitive")).toEqual(["SESSION_SECRET", "STRIPE_SECRET_KEY"]);
    expect([...container.querySelectorAll("[role=tab]")].map((tab) => tab.textContent)).toEqual([
      "Shared2",
      "appdev",
      "appstage",
      "db",
    ]);
  });
});

describe("VaultPanelBody — states", () => {
  it("draws skeleton rows until the vault is read, and no values", async () => {
    const unread: VaultView = { status: "unread", scopes: [], notLive: [] };
    const { container } = await mount({ view: unread });
    expect(q(container, "[data-vault-skeleton]")).not.toBeNull();
    expect(container.querySelectorAll("[data-vault-row]")).toHaveLength(0);
    expect(button(container, "Add").disabled).toBe(true);
  });

  it("says it couldn't read the vault above what it kept", async () => {
    const { container } = await mount({ view: { ...VAULT_FIXTURE, status: "failed" } });
    expect(q(container, "[data-vault-failed]")?.textContent).toBe("Couldn't read the vault");
    expect(rowKeys(container, "plain")).toEqual(["API_URL", "LOG_LEVEL"]);
  });
});

describe("VaultPanelBody — edit as text", () => {
  it("reviews each change with what it means and applies them one write each", async () => {
    const { container, writes } = await mount();
    await click(button(container, "Edit as text"));
    const [plain, sensitive] = [
      ...container.querySelectorAll<HTMLTextAreaElement>("[data-vault-text] textarea"),
    ];
    expect(plain?.value).toBe("API_URL=https://api.acme.dev\nLOG_LEVEL=debug");
    expect(sensitive?.value).toBe(
      "LEGACY_TOKEN=••••••••\nSESSION_SECRET=••••••••\nSTRIPE_SECRET_KEY=••••••••",
    );
    await typeInto(plain!, "API_URL=https://api.acme.shop\nLOG_LEVEL=debug\nCDN_URL=https://cdn");
    await typeInto(sensitive!, "SESSION_SECRET=••••••••\nSTRIPE_SECRET_KEY=••••••••");
    await click(button(container, "Review 3 changes"));
    const lines = [...container.querySelectorAll("[data-vault-review-line]")].map(
      (line) => line.textContent,
    );
    expect(lines).toEqual([
      "+CDN_URLhttps://cdnnothing reads it yet",
      "~API_URLhttps://api.acme.shopappdev and appstage read it — restart appdev and appstage",
      "−LEGACY_TOKENappstage reads it — it would get the literal textRemove anyway",
    ]);
    await click(button(container, "Apply 2 changes"));
    expect(writes.map(({ write }) => `${write.kind} ${write.key}`)).toEqual([
      "add CDN_URL",
      "update API_URL",
    ]);
  });

  it("applies a guarded removal once the person says remove anyway", async () => {
    const { container, writes } = await mount();
    await click(button(container, "Edit as text"));
    const sensitive = container.querySelectorAll<HTMLTextAreaElement>(
      "[data-vault-text] textarea",
    )[1];
    await typeInto(sensitive!, "SESSION_SECRET=••••••••\nSTRIPE_SECRET_KEY=••••••••");
    await click(button(container, "Review 1 change"));
    expect(button(container, "Apply 0 changes").disabled).toBe(true);
    await click(button(container, "Remove anyway"));
    await click(button(container, "Apply 1 change"));
    expect(writes.map(({ write }) => write)).toEqual([
      { kind: "remove", id: "v-legacy", key: "LEGACY_TOKEN" },
    ]);
  });

  it("jumps to the text when a .env is pasted into the key", async () => {
    const { container } = await mount();
    await click(button(container, "Add"));
    const key = q(container, '[data-vault-add] input[aria-label="Key"]')!;
    await act(async () => {
      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", {
        value: { getData: () => "CDN_URL=https://cdn\nGITHUB_TOKEN=ghp" },
      });
      key.dispatchEvent(event);
    });
    const [plain, sensitive] = [
      ...container.querySelectorAll<HTMLTextAreaElement>("[data-vault-text] textarea"),
    ];
    expect(plain?.value.split("\n").at(-1)).toBe("CDN_URL=https://cdn");
    expect(sensitive?.value.split("\n").at(-1)).toBe("GITHUB_TOKEN=ghp");
  });
});
