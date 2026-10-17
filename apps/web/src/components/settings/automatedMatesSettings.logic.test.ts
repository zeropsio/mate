import { describe, expect, it } from "vite-plus/test";

import {
  aiKeyLine,
  githubRepoOf,
  intakeAnswerLine,
  intakeLine,
  intakeRepoChoices,
} from "./automatedMatesSettings.logic";

const remote = (url: string) => ({
  url,
  repositoryId: null,
  keptAt: "2026-10-01T00:00:00.000Z",
  keptBy: "u1",
  expiresAt: null,
  invalidSince: null,
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
        webhookUrl: "https://hq.example/hook",
        hook,
      }),
    ).toBe(line);
  });
});

describe("the organization's API key", () => {
  const day = (iso: string) => iso.slice(0, 10);
  it.each([
    ["never set", undefined, "Not set"],
    ["removed", { set: false, setAt: null }, "Not set"],
    ["set, with its day", { set: true, setAt: "2026-10-17T09:00:00.000Z" }, "Set on 2026-10-17"],
    ["set, its day unknown", { set: true, setAt: null }, "Set"],
  ] as const)("says it is %s, never its value", (_case, view, line) => {
    expect(aiKeyLine(view, day)).toBe(line);
  });
});
