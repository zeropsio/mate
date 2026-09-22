import { describe, expect, it } from "vite-plus/test";

import { ZEROPS_AGENT_LOGIN_HANDLERS } from "./zeropsAgentLoginHandlers.ts";
import { stallLoginAction, stepLoginOutput } from "./zeropsAgentLoginWalker.ts";

const claude = ZEROPS_AGENT_LOGIN_HANDLERS["claude-code"];
const codex = ZEROPS_AGENT_LOGIN_HANDLERS.codex;

// Fixture lines transcribed verbatim from the live-verified F8 ledger row
// (docs/internals/zerops/verified.md, "S7 — agent auth" section this brief
// cites) — Claude's interactive login-method menu, its "Browser didn't
// open…" hint + auth URL, and Codex's device-auth URL + one-time code.
const CLAUDE_MENU = [
  "Select login method:",
  "1. Claude account with subscription",
  "2. Anthropic Console account",
  "",
  "Enter to select, Esc to cancel",
  "",
].join("\n");

const CLAUDE_URL = "https://claude.com/cai/oauth/authorize?code=true&state=abc123def456";

const CLAUDE_URL_HINT = `Browser didn't open? Use the url below to sign in (c to copy)\n${CLAUDE_URL}\n`;

const CLAUDE_PASTE_PROMPT = "Paste code here if prompted: ";

const CLAUDE_SUCCESS = "Login successful. Press Enter to continue…\n";

const CODEX_URL = "https://auth.openai.com/codex/device";
// The handler's deviceCodePattern is 4 chars - 5 chars (`\b([A-Z0-9]{4}-[A-Z0-9]{5})\b`).
const CODEX_CODE = "WDJB-MJHTP";
const CODEX_URL_AND_CODE = `${CODEX_URL}\nEnter this one-time code: ${CODEX_CODE}\n`;
const CODEX_SUCCESS = "Successfully logged in\n";

describe("stepLoginOutput — claude-code", () => {
  // Recorded live, Claude 2.1.278, 2026-09-22: a wrong code answered at the
  // prompt. The code itself echoes masked.
  const CLAUDE_WRONG_CODE =
    "*******ode\nOAuth error: Request failed with status code 400\nPress Enter to retry.\n";

  it.each([
    { name: "a wrong code fails", buffer: CLAUDE_WRONG_CODE, next: "failed" },
    { name: "the success line succeeds", buffer: CLAUDE_SUCCESS, next: "succeeded" },
    { name: "the masked echo alone waits", buffer: "*******ode", next: "verifying-code" },
  ] as const)("verifying-code: $name", ({ buffer, next }) => {
    const result = stepLoginOutput({ phase: "verifying-code", handler: claude, buffer });
    expect(result.nextPhase).toBe(next);
    // Nothing is typed into a CLI that is exchanging a code.
    expect(result.write).toBeUndefined();
    expect(result.armStall).toBe(false);
  });

  it("an unrecognized menu screen arms the stall and stays in menu", () => {
    const result = stepLoginOutput({ phase: "menu", handler: claude, buffer: CLAUDE_MENU });
    expect(result.nextPhase).toBe("menu");
    expect(result.armStall).toBe(true);
    expect(result.clearBuffer).toBe(false);
    expect(result.write).toBeUndefined();
  });

  it("a Y/N prompt auto-confirms with y\\r and stays in menu", () => {
    const result = stepLoginOutput({
      phase: "menu",
      handler: claude,
      buffer: "Continue? (y/n)\n",
    });
    expect(result.nextPhase).toBe("menu");
    expect(result.write).toBe("y\r");
    expect(result.clearBuffer).toBe(true);
  });

  it("the auth URL hint moves to awaiting-browser with the extracted url", () => {
    const result = stepLoginOutput({ phase: "menu", handler: claude, buffer: CLAUDE_URL_HINT });
    expect(result.nextPhase).toBe("awaiting-browser");
    expect(result.url).toBe(CLAUDE_URL);
    expect(result.code).toBeUndefined();
    expect(result.clearBuffer).toBe(true);
  });

  it("a URL split mid-token across two chunks does not complete on the prefix", () => {
    const prefix = CLAUDE_URL_HINT.slice(0, 40);
    const first = stepLoginOutput({ phase: "menu", handler: claude, buffer: prefix });
    expect(first.nextPhase).toBe("menu");
    expect(first.url).toBeUndefined();
    // The buffer accumulates (clearBuffer was false), so the caller re-feeds
    // the FULL buffer including the first chunk next time.
    expect(first.clearBuffer).toBe(false);

    const second = stepLoginOutput({ phase: "menu", handler: claude, buffer: CLAUDE_URL_HINT });
    expect(second.nextPhase).toBe("awaiting-browser");
    expect(second.url).toBe(CLAUDE_URL);
  });

  it('the "paste code here" prompt (no URL match) moves to awaiting-code', () => {
    const result = stepLoginOutput({ phase: "menu", handler: claude, buffer: CLAUDE_PASTE_PROMPT });
    expect(result.nextPhase).toBe("awaiting-code");
    expect(result.clearBuffer).toBe(true);
  });

  it("the success line moves to succeeded from awaiting-code", () => {
    const result = stepLoginOutput({
      phase: "awaiting-code",
      handler: claude,
      buffer: CLAUDE_SUCCESS,
    });
    expect(result.nextPhase).toBe("succeeded");
    expect(result.clearBuffer).toBe(true);
  });

  it("the success line moves to succeeded even from menu (typed code directly, no dialog round-trip)", () => {
    const result = stepLoginOutput({ phase: "menu", handler: claude, buffer: CLAUDE_SUCCESS });
    expect(result.nextPhase).toBe("succeeded");
  });

  it("an error pattern is ignored while still in menu (avoids a false positive during TUI navigation)", () => {
    const result = stepLoginOutput({
      phase: "menu",
      handler: claude,
      buffer: "login failed\n",
    });
    expect(result.nextPhase).toBe("menu");
  });

  it("an error pattern moves to failed once awaiting a code", () => {
    const result = stepLoginOutput({
      phase: "awaiting-code",
      handler: claude,
      buffer: "Authentication error: invalid code\n",
    });
    expect(result.nextPhase).toBe("failed");
    expect(result.message).toBeDefined();
  });

  it("a mid-escape tail never arms the stall", () => {
    const result = stepLoginOutput({ phase: "menu", handler: claude, buffer: "committed\x1b[3" });
    expect(result.armStall).toBe(false);
  });
});

describe("stepLoginOutput — codex", () => {
  it("the url alone (code not yet arrived) holds in menu without clearing the buffer", () => {
    const result = stepLoginOutput({ phase: "menu", handler: codex, buffer: `${CODEX_URL}\n` });
    expect(result.nextPhase).toBe("menu");
    expect(result.url).toBeUndefined();
    expect(result.clearBuffer).toBe(false);
    // Pressing Enter mid-device-auth could submit garbage.
    expect(result.armStall).toBe(false);
  });

  it("the url and device code together move to awaiting-browser with both", () => {
    const result = stepLoginOutput({ phase: "menu", handler: codex, buffer: CODEX_URL_AND_CODE });
    expect(result.nextPhase).toBe("awaiting-browser");
    expect(result.url).toBe(CODEX_URL);
    expect(result.code).toBe(CODEX_CODE);
    expect(result.clearBuffer).toBe(true);
  });

  it("Codex's own success line moves to succeeded", () => {
    const result = stepLoginOutput({
      phase: "awaiting-browser",
      handler: codex,
      buffer: CODEX_SUCCESS,
    });
    expect(result.nextPhase).toBe("succeeded");
  });

  it("never auto-confirms a y/n prompt (Codex's device flow has none)", () => {
    const result = stepLoginOutput({ phase: "menu", handler: codex, buffer: "(y/n)\n" });
    expect(result.write).toBeUndefined();
    expect(result.nextPhase).toBe("menu");
  });

  it("never enters awaiting-code (Codex's pasteCodePattern never matches)", () => {
    const result = stepLoginOutput({
      phase: "menu",
      handler: codex,
      buffer: "paste code here\n",
    });
    expect(result.nextPhase).toBe("menu");
  });
});

describe("stallLoginAction", () => {
  it("sends Enter while still navigating (starting/menu)", () => {
    expect(stallLoginAction("starting")).toEqual({ write: "\r", clearBuffer: true });
    expect(stallLoginAction("menu")).toEqual({ write: "\r", clearBuffer: true });
  });

  it("is a no-op once the phase has moved past navigation (a real transition beat the stale timer)", () => {
    for (const phase of [
      "awaiting-browser",
      "awaiting-code",
      "succeeded",
      "failed",
      "cancelled",
    ] as const) {
      expect(stallLoginAction(phase)).toEqual({ clearBuffer: false });
    }
  });
});
