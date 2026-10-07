// @vitest-environment happy-dom
import type {
  VaultScopeRef,
  VaultValue,
  VaultView,
  VaultWrite,
} from "@t3tools/client-runtime/data";
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
}

async function mount(over: Partial<VaultPanelBodyProps> = {}): Promise<Mounted> {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const writes: Mounted["writes"] = [];
  const restarts: Array<string> = [];
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const view = over.view ?? VAULT_FIXTURE;
  const props: VaultPanelBodyProps = {
    view,
    actor: "mate",
    who: { kind: "mate", name: "Fen", tint: "olive" },
    pending: new Map(),
    restarting: new Set(),
    impactOf: (scope, write) => vaultFixtureImpact(view, scope, write),
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
  return { container, writes, restarts };
}

/** The environment's values with more of its own, as a view of the fixture. */
const withShared = (...values: ReadonlyArray<VaultValue>): VaultView => ({
  ...VAULT_FIXTURE,
  notLive: [],
  scopes: VAULT_FIXTURE.scopes.map((scope) =>
    scope.kind === "shared" ? { ...scope, values: [...scope.values, ...values] } : scope,
  ),
});

const plain = (id: string, key: string, value: string): VaultValue => ({
  id,
  key,
  sensitive: false,
  value,
  createdAt: "2026-10-01T12:00:00.000Z",
  changedAt: "2026-10-01T12:00:00.000Z",
  madeByZerops: false,
  readers: [],
});

const q = <T extends Element = HTMLElement>(container: Element, selector: string) =>
  container.querySelector(selector) as T | null;
/** Each card of values: its title, then its rows' keys. */
const cards = (container: Element) =>
  [...container.querySelectorAll("[data-vault-group]")].map(
    (card) =>
      `${card.querySelector("h3")?.textContent}: ${[...card.querySelectorAll("[data-vault-row]")]
        .map((row) => row.getAttribute("data-vault-row"))
        .join(",")}`,
  );
const button = (container: Element, words: string) => {
  const found = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === words,
  );
  if (found === undefined) throw new Error(`No button "${words}"`);
  return found as HTMLButtonElement;
};
const hasButton = (container: Element, words: string) =>
  [...container.querySelectorAll("button")].some(
    (candidate) => candidate.textContent?.trim() === words,
  );
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
const openApp = async (container: Element, hostname: string) => {
  await click(q(container, '[data-vault-view="apps"]'));
  await click(q(container, `[data-vault-app="${hostname}"] button`));
};
/** Opens the "⋯" menu and picks an item from it. */
const fromMenu = async (container: Element, words: string) => {
  const trigger = q(container, 'button[aria-label="More"]')!;
  await act(async () => {
    trigger.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
    trigger.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    trigger.click();
  });
  const item = [...document.querySelectorAll("[role=menuitem]")].find(
    (candidate) => candidate.textContent?.trim() === words,
  );
  if (item === undefined) throw new Error(`No menu item "${words}"`);
  await click(item);
};

describe("VaultPanelBody — what the Vault tab shows", () => {
  it("draws the environment's values in cards named for what each is for, each on one line under its name in words", async () => {
    const { container } = await mount();
    expect(q(container, '[data-vault-view="values"]')?.getAttribute("aria-selected")).toBe("true");
    expect(cards(container)).toEqual([
      "Stripe: STRIPE_SECRET_KEY",
      "Addresses: API_URL",
      "Other settings: LEGACY_TOKEN,LOG_LEVEL",
      "Security keys: SESSION_SECRET",
    ]);
    expect(q(container, '[data-vault-row="API_URL"] > button')?.textContent).toBe(
      "API URLhttps://api.acme.dev",
    );
    expect(q(container, '[data-vault-row="STRIPE_SECRET_KEY"] > button')?.textContent).toBe(
      "Secret key●●●●●●●●",
    );
  });

  it("an open row names the apps whose deploy config uses it, and which of them still run the old value", async () => {
    const { container } = await mount();
    await openRow(container, "LOG_LEVEL");
    expect(q(container, '[data-vault-body="LOG_LEVEL"] [data-vault-readers]')?.textContent).toBe(
      "Used by appdev. appdev still runs the old value — Fen applies it with your next message.",
    );
    await openRow(container, "STRIPE_SECRET_KEY");
    expect(
      q(container, '[data-vault-body="STRIPE_SECRET_KEY"] [data-vault-readers]')?.textContent,
    ).toContain("No app uses it yet: an app's deploy config has to name it.");
  });

  it("says what is not live yet, and beside a Mate who makes it live", async () => {
    const { container } = await mount();
    const block = q(container, "[data-vault-notlive]");
    expect(
      [...block!.querySelectorAll("[data-vault-notlive-item]")].map((item) => item.textContent),
    ).toEqual(["appdev started before LOG_LEVEL changed — a restart applies it"]);
    expect(block?.textContent).toContain("Fen does it with your next message");
    expect(block?.textContent).not.toContain("Restart appdev");
  });

  it("draws no block when everything is live", async () => {
    const { container } = await mount({ view: { ...VAULT_FIXTURE, notLive: [] } });
    expect(q(container, "[data-vault-notlive]")).toBeNull();
  });

  it("opens the row an item names", async () => {
    const { container } = await mount();
    await click(q(container, '[data-vault-notlive-item="restart:svc-appdev"]'));
    expect(
      q(container, '[data-vault-row="LOG_LEVEL"] > button')?.getAttribute("aria-expanded"),
    ).toBe("true");
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
    expect(body.textContent).toContain("Used by appdev and appstage.");
    expect(body.querySelector("[data-vault-copy]")?.getAttribute("data-vault-copy")).toBe(
      "${API_URL}",
    );
    await typeInto(body.querySelector('input[aria-label="API URL"]'), "https://api.acme.shop");
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
    const body = q(container, '[data-vault-body="SESSION_SECRET"]')!;
    const field = body.querySelector<HTMLInputElement>('input[aria-label="Session secret"]')!;
    expect(field.value).toBe("");
    expect(field.type).toBe("password");
    expect(hasButton(body, "Make secret")).toBe(false);
    await typeInto(field, "s3cret");
    await click(button(body, "Save"));
    expect(writes[0]?.write).toEqual({
      kind: "update",
      id: "v-session",
      key: "SESSION_SECRET",
      value: "s3cret",
      sensitive: true,
    });
  });

  it("makes a readable secret secret with the same value, once the person confirms", async () => {
    const { container, writes } = await mount({
      view: withShared(plain("v-cookie", "COOKIE_SECRET", "cookie-value")),
    });
    expect(q(container, '[data-vault-row="COOKIE_SECRET"] > button')?.textContent).toBe(
      "Cookie secret●●●●●●●●",
    );
    await openRow(container, "COOKIE_SECRET");
    const body = q(container, '[data-vault-body="COOKIE_SECRET"]')!;
    await click(button(body, "Make secret"));
    expect(writes).toEqual([]);
    expect(body.querySelector("[role=alertdialog]")?.textContent).toContain(
      "Once it's secret, nobody can read it back",
    );
    await click(button(body, "Make it secret"));
    expect(writes[0]?.write).toEqual({
      kind: "update",
      id: "v-cookie",
      key: "COOKIE_SECRET",
      value: "cookie-value",
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
    const body = q(container, '[data-vault-body="LOG_LEVEL"]')!;
    await typeInto(body.querySelector('input[aria-label="Log level"]'), "info");
    await click(button(body, "Save"));
    expect(q(container, '[data-vault-row="LOG_LEVEL"] [role=alert]')?.textContent).toBe(
      "Letters, digits and _ only, not starting with a digit",
    );
  });

  it("shows a spinner on a row while the account writes it", async () => {
    const pending = new Map<string, VaultPending>([["shared:API_URL", { kind: "saving" }]]);
    const { container } = await mount({ pending });
    expect(q(container, '[data-vault-row="API_URL"] [role=status]')).not.toBeNull();
  });
});

describe("VaultPanelBody — what needs the person", () => {
  it("takes a paste for each value not set, and saves a secret-shaped name secret", async () => {
    const { container, writes } = await mount({
      view: withShared(
        plain("v-sak", "STRIPE_API_KEY", ""),
        plain("v-spk", "STRIPE_PUBLISHABLE_KEY", ""),
      ),
    });
    const card = q(container, '[data-vault-needs="unset"]')!;
    expect(card.querySelector("h3")?.textContent).toBe("Stripe isn't set up yet");
    expect(cards(container)[0]).toBe("Stripe: STRIPE_SECRET_KEY");
    await typeInto(card.querySelector('input[aria-label="API key"]'), "stripe-api-1");
    await typeInto(card.querySelector('input[aria-label="Publishable key"]'), "stripe-pub-1");
    await click(button(card, "Save 2"));
    expect(writes.map(({ write }) => write)).toEqual([
      {
        kind: "update",
        id: "v-sak",
        key: "STRIPE_API_KEY",
        value: "stripe-api-1",
        sensitive: true,
      },
      {
        kind: "update",
        id: "v-spk",
        key: "STRIPE_PUBLISHABLE_KEY",
        value: "stripe-pub-1",
        sensitive: false,
      },
    ]);
  });

  it("offers to make every readable secret secret at once, and leaves a sign-in password readable", async () => {
    const { container, writes } = await mount({
      view: withShared(
        plain("v-cookie", "COOKIE_SECRET", "cookie-value"),
        plain("v-jwt", "JWT_SECRET", "jwt-value"),
        plain("v-admin", "SUPERADMIN_PASSWORD", "admin-value"),
      ),
    });
    const card = q(container, '[data-vault-needs="readable"]')!;
    expect(card.querySelector("h3")?.textContent).toBe("2 secrets aren't protected");
    await click(button(card, "Make secret"));
    expect(
      writes.map(({ write }) => `${write.key} ${write.kind === "update" && write.sensitive}`),
    ).toEqual(["COOKIE_SECRET true", "JWT_SECRET true"]);
  });
});

describe("VaultPanelBody — adding", () => {
  it("turns Secret on for a secret-sounding name, and adds", async () => {
    const { container, writes } = await mount();
    await click(button(container, "Add"));
    const add = q(container, "[data-vault-add]")!;
    expect(add.textContent).toContain("New value for every app");
    await typeInto(add.querySelector('input[aria-label="Key"]'), "GITHUB_TOKEN");
    expect(add.querySelector("[role=switch]")?.getAttribute("aria-checked")).toBe("true");
    expect(add.querySelector("[data-vault-add-auto]")?.textContent).toBe(
      "the name says secret — nobody reads it back once saved",
    );
    await typeInto(add.querySelector('input[aria-label="Value"]'), "ghp_x");
    await click(button(add, "Save"));
    expect(writes[0]).toEqual({
      scope: { kind: "shared" },
      write: { kind: "add", key: "GITHUB_TOKEN", value: "ghp_x", sensitive: true },
    });
  });

  it.each([
    [null, "api_url", "API_URL already exists"],
    [null, "bad-key!", "Letters, digits and _ only, not starting with a digit"],
    ["appdev", "NODE_ENV", "appdev's zerops.yml already sets NODE_ENV"],
  ])("in %s refuses %s inline", async (app, key, words) => {
    const { container, writes } = await mount();
    if (app !== null) await openApp(container, app);
    await click(button(container, "Add"));
    const add = q(container, "[data-vault-add]")!;
    await typeInto(add.querySelector('input[aria-label="Key"]'), key);
    expect(add.querySelector("[data-vault-add-error]")?.textContent).toBe(words);
    expect(button(add, "Save").disabled).toBe(true);
    expect(writes).toEqual([]);
  });
});

describe("VaultPanelBody — apps", () => {
  it("lists each app and each service Zerops runs, in words", async () => {
    const { container } = await mount();
    await click(q(container, '[data-vault-view="apps"]'));
    expect(cards(container).map((card) => card.split(":")[0])).toEqual([
      "Your apps",
      "Run by Zerops",
    ]);
    const app = (host: string) => q(container, `[data-vault-app="${host}"]`)?.textContent;
    expect(app("appdev")).toBe("appdevNode.js app1 value");
    expect(app("appstage")).toBe("appstageNode.js app");
    expect(app("db")).toBe("dbDatabase · PostgreSQL");
  });

  it("shows what an app reads from its deploy config and where each comes from", async () => {
    const { container } = await mount();
    await openApp(container, "appdev");
    const reads = q(container, '[data-vault-group="reads"]')!;
    expect(reads.querySelector("h3")?.textContent).toBe("What it reads from the deploy config");
    const line = (key: string) => reads.querySelector(`[data-vault-read="${key}"]`)?.textContent;
    expect(line("NODE_ENV")).toBe("NODE_ENV= development");
    expect(line("API_URL")).toBe("API_URLAPI_URL· vault");
    expect(line("FEATURE_FLAGS")).toBe("FEATURE_FLAGSFEATURE_FLAGS· its own");
    expect(line("DATABASE_URL")).toBe("DATABASE_URLconnectionString· db");
    expect(line("PUBLIC_HOST")).toBe("PUBLIC_HOSTfrom Zerops");
    expect(line("SEARCH_URL")).toBe("SEARCH_URLmissing");
    expect(line("DB_PASSWORD")).toBe("DB_PASSWORDself");
  });

  it("links an app's deploy config where the workspace has it", async () => {
    const { container } = await mount({
      renderDeployConfig: (hostname) => <span data-config>{`${hostname}/zerops.yaml`}</span>,
    });
    await openApp(container, "appdev");
    expect(q(container, '[data-vault-group="reads"] [data-config]')?.textContent).toBe(
      "appdev/zerops.yaml",
    );
  });

  it("goes to the value a read comes from", async () => {
    const { container } = await mount();
    await openApp(container, "appdev");
    await click(q(container, '[data-vault-read="LOG_LEVEL"]'));
    expect(q(container, '[data-vault-view="values"]')?.getAttribute("aria-selected")).toBe("true");
    expect(
      q(container, '[data-vault-row="LOG_LEVEL"] > button')?.getAttribute("aria-expanded"),
    ).toBe("true");
  });

  it("draws a managed service's values read only, each with its reference", async () => {
    const { container } = await mount();
    await openApp(container, "db");
    expect(hasButton(container, "Add")).toBe(false);
    expect(q(container, '[data-vault-row="password"]')?.textContent).toContain("●●●●●●●●");
    expect(
      q(container, '[data-vault-row="password"] [data-vault-copy]')?.getAttribute(
        "data-vault-copy",
      ),
    ).toBe("${db_password}");
    expect(q(container, '[data-vault-row="password"] > button')).toBeNull();
  });

  it("says an app has nothing of its own yet, with Add", async () => {
    const { container } = await mount();
    await openApp(container, "appstage");
    expect(container.textContent).toContain("Nothing of its own yet.");
    await click(button(container, "Add one"));
    expect(q(container, "[data-vault-add]")?.textContent).toContain("New value for appstage only");
  });
});

describe("VaultPanelBody — search", () => {
  it("finds values by their name, key or value across every app", async () => {
    const { container } = await mount();
    await click(q(container, 'button[aria-label="Search"]'));
    await typeInto(q(container, 'input[aria-label="Search"]'), "secret");
    expect(cards(container)).toEqual([
      "Stripe: STRIPE_SECRET_KEY",
      "Security keys: SESSION_SECRET",
    ]);
    await typeInto(q(container, 'input[aria-label="Search"]'), "cart-vat");
    expect(cards(container)).toEqual(["appdev: FEATURE_FLAGS"]);
  });
});

describe("VaultPanelBody — states", () => {
  it("draws skeleton rows until the vault is read, and no values", async () => {
    const unread: VaultView = { status: "unread", complete: false, scopes: [], notLive: [] };
    const { container } = await mount({ view: unread });
    expect(q(container, "[data-vault-skeleton]")).not.toBeNull();
    expect(container.querySelectorAll("[data-vault-row]")).toHaveLength(0);
    expect(hasButton(container, "Add")).toBe(false);
  });

  it("says it couldn't read the vault above what it kept", async () => {
    const { container } = await mount({ view: { ...VAULT_FIXTURE, status: "failed" } });
    expect(q(container, "[data-vault-failed]")?.textContent).toBe("Couldn't read the vault");
    expect(cards(container)).toContain("Addresses: API_URL");
  });
});

describe("VaultPanelBody — edit as text", () => {
  it("reviews each change with what it means and applies them one write each", async () => {
    const { container, writes } = await mount();
    await fromMenu(container, "Edit as text");
    const [plainText, sensitive] = [
      ...container.querySelectorAll<HTMLTextAreaElement>("[data-vault-text] textarea"),
    ];
    expect(plainText?.value).toBe("API_URL=https://api.acme.dev\nLOG_LEVEL=debug");
    expect(sensitive?.value).toBe(
      "LEGACY_TOKEN=••••••••\nSESSION_SECRET=••••••••\nSTRIPE_SECRET_KEY=••••••••",
    );
    await typeInto(
      plainText!,
      "API_URL=https://api.acme.shop\nLOG_LEVEL=debug\nCDN_URL=https://cdn",
    );
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
    await fromMenu(container, "Edit as text");
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
    const [plainText, sensitive] = [
      ...container.querySelectorAll<HTMLTextAreaElement>("[data-vault-text] textarea"),
    ];
    expect(plainText?.value.split("\n").at(-1)).toBe("CDN_URL=https://cdn");
    expect(sensitive?.value.split("\n").at(-1)).toBe("GITHUB_TOKEN=ghp");
  });
});
