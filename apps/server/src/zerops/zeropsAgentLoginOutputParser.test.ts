import { describe, expect, it } from "vite-plus/test";

import {
  DEVICE_CODE_CONTINUATION,
  URL_TOKEN_CONTINUATION,
  matchAuthUrl,
  matchCompletedToken,
  parseTerminalOutput,
} from "./zeropsAgentLoginOutputParser.ts";

// Mirrors Claude's own auth-URL anchor — matchAuthUrl appends the URL token tail.
const AUTH_URL_PATTERN = /https:\/\/[^\s]*\/oauth\/authorize/;

// RFC3986 reserved characters included on purpose — a complete match must absorb them.
const URI = "https://claude.com/cai/oauth/authorize?state=ab$c'()*,;x";

const expectNoShortCompleteAtAnyCut = (input: string) => {
  for (let cut = 0; cut <= input.length; cut++) {
    const result = matchAuthUrl(parseTerminalOutput(input.slice(0, cut)), AUTH_URL_PATTERN);
    expect(result.status === "complete" && result.value.length < URI.length).toBe(false);
  }
  expect(matchAuthUrl(parseTerminalOutput(input), AUTH_URL_PATTERN)).toEqual({
    status: "complete",
    value: URI,
  });
};

describe("zeropsAgentLoginOutputParser — ported from the Zerops GUI's zcp-agent-auth-dialog walker", () => {
  it.each([
    [
      "OSC 8 hyperlink row",
      `\x1b]8;id=auth-url;${URI}\x07${URI.slice(0, 30)}\x1b[m\x1b]8;;\x07\r\n\n`,
    ],
    ["plain-printed URL", `some prompt text\n${URI}\n`],
    ["PTY-style CRLF", `some prompt text\r\n${URI}\r\n`],
  ])("never yields a short complete at any cut offset: %s", (_label, input) => {
    expectNoShortCompleteAtAnyCut(input);
  });

  it.each([
    ["erase-line rewrite", `${URI.slice(0, -8)}\r\x1b[2K${URI}\n`],
    ["bare-CR spinner rewrite", `${URI.slice(0, -8)}\r${URI}\r\n`],
    ["retracted earlier occurrence", `${URI.replace("state=", "state=zzz")}\r\x1b[2K${URI}\n`],
  ])("prefers the terminated redraw over a retracted render: %s", (_label, raw) => {
    expect(matchAuthUrl(parseTerminalOutput(raw), AUTH_URL_PATTERN)).toEqual({
      status: "complete",
      value: URI,
    });
  });

  it("holds an unstable tail: pending at buffer edge, ambiguous trailing CR held back", () => {
    expect(matchAuthUrl(parseTerminalOutput(`prompt\n${URI}`), AUTH_URL_PATTERN)).toEqual({
      status: "pending",
    });

    // A trailing bare '\r' could still become a CRLF commit OR a rewrite — held back whole.
    expect(parseTerminalOutput(`prompt\n${URI}\r`)).toEqual({
      clean: `prompt\n${URI}`,
      hyperlinkUris: [],
      endsInsideEscape: true,
    });
    expect(parseTerminalOutput(`prompt\n${URI}\n`).endsInsideEscape).toBe(false);

    expect(matchAuthUrl(parseTerminalOutput(`prompt\n${URI}\r\n`), AUTH_URL_PATTERN)).toEqual({
      status: "complete",
      value: URI,
    });
    expect(matchAuthUrl(parseTerminalOutput(`prompt\n${URI}\rspinner`), AUTH_URL_PATTERN)).toEqual({
      status: "none",
    });
  });

  it.each([
    ["mid OSC 8 uri", "committed\x1b]8;id=auth-url;https://foo.com/bar"],
    ["mid CSI", "committed\x1b[3"],
    ["bare ESC", "committed\x1b"],
  ])("incomplete trailing escape (%s) sets endsInsideEscape and leaks nothing", (_label, raw) => {
    expect(parseTerminalOutput(raw)).toEqual({
      clean: "committed",
      hyperlinkUris: [],
      endsInsideEscape: true,
    });
  });

  it("DEC-graphics divider commits the URL without gluing onto it", () => {
    // 'q' glyphs are valid URL chars — only the graphics-mode boundary stops the
    // tail, and printing the divider is commit evidence, so this must complete.
    expect(
      matchAuthUrl(parseTerminalOutput(`${URI}\x1b(0qqqq\x1b(B\r\n`), AUTH_URL_PATTERN),
    ).toEqual({
      status: "complete",
      value: URI,
    });
  });

  it("unclosed OSC 8 link stops skipping in-link text at the newline safety bound", () => {
    const parsed = parseTerminalOutput("\x1b]8;id=x;http://foo\x07SKIPPED SLICE\nAFTER LINK");
    expect(parsed.hyperlinkUris).toEqual(["http://foo"]);
    expect(parsed.clean).not.toContain("SKIPPED SLICE");
    expect(parsed.clean).toContain("AFTER LINK");
  });

  it("prompt patterns survive injected invalidation boundaries (`\\v` is inside `\\s`)", () => {
    const raw = `Select${"\x1b[2K"}login${"\r"}method${"\x1b[K"}now`;
    expect(/Select\s+login\s+method\s+now/i.test(parseTerminalOutput(raw).clean)).toBe(true);
  });

  it("soft-wrap is a rendering concern, not a raw-byte one: no inserted newline mid-URL", () => {
    // F8's live finding: a long OAuth URL wraps across visual terminal rows.
    // The raw PTY byte stream this parser reads carries no line break at the
    // wrap point — only the client's own terminal rendering wraps it — so a
    // single unbroken write completes in one shot with no chunking needed.
    const raw = `Use the url below to sign in (c to copy)\n${URI}\n`;
    expect(matchAuthUrl(parseTerminalOutput(raw), AUTH_URL_PATTERN)).toEqual({
      status: "complete",
      value: URI,
    });
  });

  describe("matchCompletedToken gate", () => {
    const codePattern = /\b([A-Z0-9]{4}-[A-Z0-9]{5})\b/;

    it("holds a device code until a terminator commits it", () => {
      expect(
        matchCompletedToken("code: ABCD-EFGHI", codePattern, DEVICE_CODE_CONTINUATION),
      ).toEqual({
        status: "pending",
      });
      expect(
        matchCompletedToken("code: ABCD-EFGHI\n", codePattern, DEVICE_CODE_CONTINUATION),
      ).toEqual({ status: "complete", value: "ABCD-EFGHI" });
      expect(
        matchCompletedToken(
          parseTerminalOutput("code: ABCD-EFGHI\r\n").clean,
          codePattern,
          DEVICE_CODE_CONTINUATION,
        ),
      ).toEqual({ status: "complete", value: "ABCD-EFGHI" });
    });

    it("refuses a fixed-URL match extended by a continuation char", () => {
      const codexPattern = /https:\/\/auth\.openai\.com\/codex\/device/;
      expect(
        matchCompletedToken(
          "go to https://auth.openai.com/codex/device\n",
          codexPattern,
          URL_TOKEN_CONTINUATION,
        ),
      ).toEqual({ status: "complete", value: "https://auth.openai.com/codex/device" });
      expect(
        matchCompletedToken(
          "go to https://auth.openai.com/codex/device/more",
          codexPattern,
          URL_TOKEN_CONTINUATION,
        ),
      ).toEqual({ status: "none" });
    });
  });
});
