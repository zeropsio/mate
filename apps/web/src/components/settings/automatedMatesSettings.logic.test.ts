import { HqAiKeyView } from "@t3tools/shared/hqIntake";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  aiKeyLine,
  githubRepoOf,
  intakeAnswerLine,
  intakeLine,
  intakeRepoChoices,
} from "./automatedMatesSettings.logic";

const decodeAiKey = Schema.decodeUnknownSync(HqAiKeyView);
const remote = (url: string) => ({
  url,
  repositoryId: null,
  keptAt: "2026-10-01T00:00:00.000Z",
  keptBy: "u1",
  expiresAt: null,
  invalidSince: null,
  via: "token" as const,
  githubAppId: null,
});

describe("where an application's tasks come from", () => {
  it.each([
    ["https://github.com/acme/tea-shop", "acme/tea-shop"],
    ["https://github.com/acme/tea-shop.git", "acme/tea-shop"],
    ["https://GitHub.com/acme/tea-shop/", "acme/tea-shop"],
    ["https://gitlab.com/acme/tea-shop", null],
    ["https://github.com/acme", null],
    ["not a url", null],
  ] as const)("reads %s as %s", (url, repo) => {
    expect(githubRepoOf(url)).toBe(repo);
  });

  it("offers the application's repositories mirrored to GitHub, each once", () => {
    expect(
      intakeRepoChoices([
        { name: "app", remote: remote("https://github.com/acme/tea-shop.git") },
        { name: "web", remote: remote("https://github.com/acme/tea-shop") },
        { name: "api", remote: remote("https://gitlab.com/acme/api") },
        { name: "docs", remote: null },
      ]),
    ).toEqual(["acme/tea-shop"]);
  });

  it("offers nothing while the repositories are not read", () => {
    expect(intakeRepoChoices(undefined)).toEqual([]);
  });

  it("says where the application's automated Mates take tasks from", () => {
    expect(intakeLine({ repo: "acme/tea-shop", label: "mate" })).toBe(
      "Takes issues labelled “mate” from acme/tea-shop",
    );
  });

  it("says where the application's automated Mates take tasks from is a public repository", () => {
    expect(intakeLine({ repo: "acme/tea-shop", label: "mate", public: true })).toBe(
      "Takes issues labelled “mate” from acme/tea-shop, a public repository",
    );
  });

  it.each([
    [{ kind: "made" } as const, "Webhook made on acme/tea-shop"],
    [
      { kind: "paste", secret: "s", why: "w" } as const,
      "Add this webhook to acme/tea-shop, in its settings › Webhooks. The secret is shown once.",
    ],
  ])("says what HQ answered as the intake was set (%o)", (hook, line) => {
    expect(
      intakeAnswerLine({
        appId: "shop",
        repo: "acme/tea-shop",
        label: "mate",
        public: false,
        webhookUrl: "https://hq.example/hook",
        hook,
      }),
    ).toBe(line);
  });

  it.each([
    [
      "by its name",
      "acme-mate",
      "Takes issues labelled “mate” from acme/tea-shop — GitHub tells Mate through acme-mate.",
    ],
    [
      "not read yet",
      undefined,
      "Takes issues labelled “mate” from acme/tea-shop — GitHub tells Mate through your organization's GitHub app.",
    ],
  ])(
    "says GitHub tells Mate through the organization's app, with nothing to paste (%s)",
    (_case, app, line) => {
      expect(
        intakeAnswerLine(
          {
            appId: "shop",
            repo: "acme/tea-shop",
            label: "mate",
            public: false,
            webhookUrl: "https://hq.example/hook",
            hook: { kind: "app" },
          },
          app,
        ),
      ).toBe(line);
    },
  );
});

describe("the organization's API key", () => {
  const day = (iso: string) => iso.slice(0, 10);
  it.each([
    ["never set", undefined, "Not set"],
    ["removed", { set: false, setAt: null, setBy: null }, "Not set"],
    [
      "set, with its day",
      { set: true, setAt: "2026-10-17T09:00:00.000Z", setBy: null },
      "Set on 2026-10-17",
    ],
    ["set, its day unknown", { set: true, setAt: null, setBy: null }, "Set"],
  ] as const)("says it is %s, never its value", (_case, view, line) => {
    expect(aiKeyLine(view, day, () => undefined)).toBe(line);
  });
});

// witness: apps/web/src/components/settings/automatedMatesSettings.logic.ts | return `Set${sealedWords(view.setBy, view.setAt, nameOf, day)}`; → return `Set${sealedWords(null, view.setAt, nameOf, day)}`;
it("the organization's model key names the Owner or Admin who set it, as the member list names them", () => {
  const view = decodeAiKey({
    provider: "nebius",
    set: true,
    setAt: "2026-10-17T09:00:00.000Z",
    setBy: "u-ada",
  });
  const nameOf = (userId: string) => (userId === "u-ada" ? "Ada Lovelace" : undefined);
  expect(aiKeyLine(view, (iso) => iso.slice(0, 10), nameOf)).toBe(
    "Set by Ada Lovelace on 2026-10-17",
  );
});
