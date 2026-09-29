import { describe, expect, it } from "vite-plus/test";

import {
  FIX_REQUEST_LOG_LINES,
  fixMateChoice,
  fixRequestPrompt,
  fixRequestWhen,
  type FixMate,
} from "./fixRequest";

const NOW = new Date("2026-09-29T10:53:00Z");
const clock = (iso: string) =>
  new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));

describe("fixRequestWhen", () => {
  it.each<{ readonly name: string; readonly at: string; readonly age: string }>([
    { name: "seconds ago reads as just now", at: "2026-09-29T10:52:40Z", age: "just now" },
    { name: "one minute is singular", at: "2026-09-29T10:52:00Z", age: "1 minute ago" },
    { name: "minutes", at: "2026-09-29T10:41:00Z", age: "12 minutes ago" },
    { name: "hours", at: "2026-09-29T07:53:00Z", age: "3 hours ago" },
    { name: "days past two", at: "2026-09-26T10:53:00Z", age: "3 days ago" },
  ])("$name", ({ at, age }) => {
    expect(fixRequestWhen(at, NOW)).toBe(`at ${clock(at)}, ${age}`);
  });

  it("a time in the future keeps only its clock", () => {
    const at = "2026-09-29T11:10:00Z";
    expect(fixRequestWhen(at, NOW)).toBe(`at ${clock(at)}`);
  });

  it("an unreadable time says nothing", () => {
    expect(fixRequestWhen("not a time", NOW)).toBe("");
  });
});

describe("fixRequestPrompt", () => {
  it("writes what failed, when, the error, the log's last lines and the ask, in that order", () => {
    const at = "2026-09-29T10:41:00Z";
    expect(
      fixRequestPrompt(
        {
          what: "Production's release v0.1.57 failed in the build step.",
          at,
          error: "Build pipeline failed; no recognised log pattern matched.",
          logLines: [
            "> pnpm install --frozen-lockfile",
            "ERR_PNPM_OUTDATED_LOCKFILE  Cannot install",
          ],
          logName: "Build log · v0.1.57",
          ask: "Find out why, fix it, and release again.",
        },
        NOW,
      ),
    ).toBe(
      [
        `Production's release v0.1.57 failed in the build step at ${clock(at)}, 12 minutes ago.`,
        "The error: Build pipeline failed; no recognised log pattern matched.",
        "Build log · v0.1.57:\n```\n> pnpm install --frozen-lockfile\nERR_PNPM_OUTDATED_LOCKFILE  Cannot install\n```",
        "Find out why, fix it, and release again.",
      ].join("\n\n"),
    );
  });

  it("leaves out what it doesn't know", () => {
    expect(fixRequestPrompt({ what: "Production is down", ask: "Bring it back." }, NOW)).toBe(
      "Production is down.\n\nBring it back.",
    );
  });

  it("keeps only the log's last lines, without blank ones", () => {
    const lines = Array.from({ length: FIX_REQUEST_LOG_LINES + 5 }, (_, i) => `line ${String(i)}`);
    const prompt = fixRequestPrompt(
      { what: "It broke", logLines: ["", ...lines, "  "], ask: "Fix it." },
      NOW,
    );
    expect(prompt).toContain("The log's last lines:\n```\nline 5\n");
    expect(prompt).toContain(`line ${String(FIX_REQUEST_LOG_LINES + 4)}\n\`\`\``);
    expect(prompt).not.toContain("line 4\n");
  });
});

describe("fixMateChoice", () => {
  const mate = (id: string, mine: boolean, lastVisitedAt?: string): FixMate => ({
    mateProjectId: id,
    mine,
    ...(lastVisitedAt === undefined ? {} : { lastVisitedAt }),
  });

  it("offers only the person's own Mates, the one used last first", () => {
    expect(
      fixMateChoice([
        mate("colleague", false, "2026-09-29T10:00:00Z"),
        mate("older", true, "2026-09-28T10:00:00Z"),
        mate("never", true),
        mate("latest", true, "2026-09-29T09:00:00Z"),
      ]).map((m) => m.mateProjectId),
    ).toEqual(["latest", "older", "never"]);
  });

  it("offers nobody when none of the project's Mates is the person's", () => {
    expect(fixMateChoice([mate("colleague", false)])).toEqual([]);
  });
});
