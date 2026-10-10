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
/** Each part of the list: its title, then its rows' keys. */
const parts = (container: Element) =>
  [...container.querySelectorAll("[data-vault-part]")].map(
    (part) =>
      `${part.querySelector("h3")?.textContent}: ${[...part.querySelectorAll("[data-vault-row]")]
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
/** Unfolds a service Zerops runs. */
const openMade = (container: Element, hostname: string) =>
  click(q(container, `[data-vault-app="${hostname}"] > button`));
/** Opens a menu by its trigger and picks an item from it. */
const pick = async (trigger: Element, words: string) => {
  await act(async () => {
    trigger.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
    trigger.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    (trigger as HTMLElement).click();
  });
  const item = [...document.querySelectorAll("[role=menuitem]")].find(
    (candidate) => candidate.textContent?.trim() === words,
  );
  if (item === undefined) throw new Error(`No menu item "${words}"`);
  await click(item);
};
/** Opens the "⋯" menu and picks an item from it. */
const fromMenu = (container: Element, words: string) =>
  pick(q(container, 'button[aria-label="More"]')!, words);

describe("VaultPanelBody — what the Vault tab shows", () => {
  it("lists what every app gets, then each app's own, then what Zerops made, each value on one line by its name and key", async () => {
    const { container } = await mount();
    expect(q(container, "[role=tablist]")).toBeNull();
    expect(parts(container)).toEqual([
      "Every app: STRIPE_SECRET_KEY,API_URL,LEGACY_TOKEN,LOG_LEVEL,SESSION_SECRET",
      "appdev: FEATURE_FLAGS",
    ]);
    expect(q(container, "[data-vault-made]")?.textContent).toBe(
      "dbDatabase · PostgreSQL5 made by Zerops",
    );
    expect(q(container, '[data-vault-row="API_URL"] > button')?.textContent).toBe(
      "API URLAPI_URLhttps://api.acme.dev",
    );
    expect(q(container, '[data-vault-row="STRIPE_SECRET_KEY"] > button')?.textContent).toBe(
      "Stripe secret keySTRIPE_SECRET_KEY●●●●●●●●",
    );
  });

  // Milo's Values said "No values yet" beside Apps listing apidev 3, appdev 2
  // (stress run 2, 2026-10-09): an empty share is not an empty vault.
  it("leaves out every app's part when the environment shares nothing, and still lists the apps' own", async () => {
    const view: VaultView = {
      ...VAULT_FIXTURE,
      notLive: [],
      scopes: VAULT_FIXTURE.scopes.map((scope) =>
        scope.kind === "shared" ? { ...scope, values: [] } : scope,
      ),
    };
    const { container } = await mount({ view });
    expect(parts(container)).toEqual(["appdev: FEATURE_FLAGS"]);
    expect(container.textContent).not.toContain("No values yet.");
  });

  it("marks a value an app still runs the old one of, on its row", async () => {
    const { container } = await mount();
    expect(q(container, '[data-vault-row="LOG_LEVEL"] [data-vault-stale]')).not.toBeNull();
    expect(q(container, '[data-vault-row="API_URL"] [data-vault-stale]')).toBeNull();
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
    ).toContain("No app uses it yet.");
  });

  it("says what is not live yet, and beside a Mate who makes it live", async () => {
    const { container } = await mount();
    const line = q(container, "[data-vault-notlive]");
    expect(line?.textContent).toBe(
      "1 value isn't live yet — Fen restarts appdev with your next message",
    );
    expect(hasButton(container, "Restart appdev")).toBe(false);
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
    expect(hasButton(body, "Hide it")).toBe(false);
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
      "Cookie secretCOOKIE_SECRET●●●●●●●●",
    );
    await openRow(container, "COOKIE_SECRET");
    const body = q(container, '[data-vault-body="COOKIE_SECRET"]')!;
    await click(button(body, "Hide it"));
    expect(writes).toEqual([]);
    const ask = body.querySelector("[role=alertdialog]")!;
    expect(ask.textContent).toContain("Nobody reads it back once it's hidden, Fen included.");
    await click(button(ask, "Hide it"));
    expect(writes[0]?.write).toEqual({
      kind: "update",
      id: "v-cookie",
      key: "COOKIE_SECRET",
      value: "cookie-value",
      sensitive: true,
    });
  });

  it("shows a secret to the person who asks, and only then", async () => {
    const asked: Array<{ scope: VaultScopeRef; id: string }> = [];
    const { container } = await mount({
      onReveal: async (scope, id) => {
        asked.push({ scope, id });
        return { ok: true, value: "session-value" };
      },
    });
    await openRow(container, "SESSION_SECRET");
    const body = q(container, '[data-vault-body="SESSION_SECRET"]')!;
    const field = body.querySelector<HTMLInputElement>('input[aria-label="Session secret"]')!;
    expect(field.value).toBe("");
    expect(asked).toEqual([]);
    await click(body.querySelector('button[aria-label="Show"]'));
    expect(asked).toEqual([{ scope: { kind: "shared" }, id: "v-session" }]);
    expect(field.value).toBe("session-value");
    expect(field.type).toBe("text");
    expect(button(body, "Save").disabled).toBe(true);
  });

  it("says why Zerops would not show a secret", async () => {
    const { container } = await mount({
      onReveal: async () => ({ ok: false, code: "notAuthorized" }),
    });
    await openRow(container, "SESSION_SECRET");
    const body = q(container, '[data-vault-body="SESSION_SECRET"]')!;
    await click(body.querySelector('button[aria-label="Show"]'));
    expect(body.querySelector("[role=alert]")?.textContent).toBe(
      "Your role in this organization can't show secrets.",
    );
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
    const line = q(container, '[data-vault-needs="unset"]')!;
    expect(line.textContent).toBe("Stripe isn't set up yet — paste them in their rows");
    await click(line);
    const first = q(container, '[data-vault-body="STRIPE_API_KEY"]')!;
    await typeInto(first.querySelector('input[aria-label="Stripe API key"]'), "stripe-api-1");
    await click(button(first, "Save"));
    await openRow(container, "STRIPE_PUBLISHABLE_KEY");
    const second = q(container, '[data-vault-body="STRIPE_PUBLISHABLE_KEY"]')!;
    await typeInto(
      second.querySelector('input[aria-label="Stripe publishable key"]'),
      "stripe-pub-1",
    );
    await click(button(second, "Save"));
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

  it("offers to make every readable secret secret at once", async () => {
    const { container, writes } = await mount({
      view: withShared(
        plain("v-cookie", "COOKIE_SECRET", "cookie-value"),
        plain("v-jwt", "JWT_SECRET", "jwt-value"),
        plain("v-admin", "SUPERADMIN_PASSWORD", "admin-value"),
      ),
    });
    expect(q(container, '[data-vault-needs="readable"]')?.textContent).toBe(
      "3 secrets can be read by anyone with access",
    );
    await click(button(container, "Hide them"));
    expect(
      writes.map(({ write }) => `${write.key} ${write.kind === "update" && write.sensitive}`),
    ).toEqual(["SUPERADMIN_PASSWORD true", "COOKIE_SECRET true", "JWT_SECRET true"]);
  });
});

describe("VaultPanelBody — adding", () => {
  it("turns Secret on for a secret-sounding name, and adds", async () => {
    const { container, writes } = await mount();
    await click(button(container, "Add"));
    const add = q(container, "[data-vault-add]")!;
    expect(add.textContent).toContain("New value forevery app");
    await typeInto(add.querySelector('input[aria-label="Key"]'), "GITHUB_TOKEN");
    expect(add.querySelector("[role=switch]")?.getAttribute("aria-checked")).toBe("true");
    expect(add.querySelector("[data-vault-add-auto]")?.textContent).toBe(
      "nobody reads it back once saved",
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
    await click(button(container, "Add"));
    const add = q(container, "[data-vault-add]")!;
    if (app !== null) await pick(add.querySelector('[aria-label="Where it goes"]')!, `${app} only`);
    await typeInto(add.querySelector('input[aria-label="Key"]'), key);
    expect(add.querySelector("[data-vault-add-error]")?.textContent).toBe(words);
    expect(button(add, "Save").disabled).toBe(true);
    expect(writes).toEqual([]);
  });
});

describe("VaultPanelBody — apps", () => {
  it("names each app with values of its own, and each service Zerops runs, in words", async () => {
    const { container } = await mount();
    expect(q(container, '[data-vault-part="svc-appdev"] header')?.textContent).toBe(
      "appdevNode.js app",
    );
    expect(q(container, '[data-vault-part="svc-appstage"]')).toBeNull();
    expect(q(container, '[data-vault-app="db"] > button')?.textContent).toBe(
      "dbDatabase · PostgreSQL5 made by Zerops",
    );
  });

  it("adds a value to one app from the same card", async () => {
    const { container, writes } = await mount();
    await click(button(container, "Add"));
    const add = q(container, "[data-vault-add]")!;
    await pick(add.querySelector('[aria-label="Where it goes"]')!, "appstage only");
    expect(add.textContent).toContain("New value forappstage only");
    await typeInto(add.querySelector('input[aria-label="Key"]'), "PORT");
    await typeInto(add.querySelector('input[aria-label="Value"]'), "3000");
    await click(button(add, "Save"));
    expect(writes[0]).toEqual({
      scope: { kind: "service", serviceId: "svc-appstage" },
      write: { kind: "add", key: "PORT", value: "3000", sensitive: false },
    });
  });

  it("links an app's deploy config where the workspace has it", async () => {
    const { container } = await mount({
      renderDeployConfig: (hostname) => <span data-config>{`${hostname}/zerops.yaml`}</span>,
    });
    expect(q(container, '[data-vault-part="svc-appdev"] [data-config]')?.textContent).toBe(
      "appdev/zerops.yaml",
    );
  });

  it("draws a managed service's values read only, each with its reference", async () => {
    const { container } = await mount();
    await openMade(container, "db");
    expect(q(container, '[data-vault-row="password"]')?.textContent).toContain("●●●●●●●●");
    expect(
      q(container, '[data-vault-row="password"] [data-vault-copy]')?.getAttribute(
        "data-vault-copy",
      ),
    ).toBe("${db_password}");
    expect(q(container, '[data-vault-row="password"] > button')).toBeNull();
  });

  it("shows a database's password on request", async () => {
    const { container } = await mount({
      onReveal: async () => ({ ok: true, value: "db-pass" }),
    });
    await openMade(container, "db");
    const row = q(container, '[data-vault-row="password"]')!;
    expect(row.querySelector("[data-vault-shown]")).toBeNull();
    await click(row.querySelector('button[aria-label="Show"]'));
    expect(row.querySelector("[data-vault-shown]")?.textContent).toBe("db-pass");
  });
});

describe("VaultPanelBody — search", () => {
  it("finds values by their name, key or value across every app", async () => {
    const { container } = await mount();
    await typeInto(q(container, 'input[aria-label="Search"]'), "secret");
    expect(parts(container)).toEqual(["Every app: STRIPE_SECRET_KEY,SESSION_SECRET"]);
    await typeInto(q(container, 'input[aria-label="Search"]'), "cart-vat");
    expect(parts(container)).toEqual(["appdev: FEATURE_FLAGS"]);
  });
});

describe("VaultPanelBody — states", () => {
  it("draws skeleton rows until the vault is read, and no values", async () => {
    const unread: VaultView = { status: "unread", complete: false, scopes: [], notLive: [] };
    const { container } = await mount({ view: unread });
    expect(q(container, "[data-vault-skeleton]")).not.toBeNull();
    expect(container.querySelectorAll("[data-vault-row]")).toHaveLength(0);
    expect(button(container, "Add").disabled).toBe(true);
  });

  it("says it couldn't read the vault above what it kept", async () => {
    const { container } = await mount({ view: { ...VAULT_FIXTURE, status: "failed" } });
    expect(q(container, "[data-vault-failed]")?.textContent).toBe("Couldn't read the vault");
    expect(parts(container)[0]).toContain("API_URL");
  });
});

describe("VaultPanelBody — edit as text", () => {
  it("reviews each change with what it means and applies them one write each", async () => {
    const { container, writes } = await mount();
    await fromMenu(container, "Every app as text");
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
    await fromMenu(container, "Every app as text");
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
