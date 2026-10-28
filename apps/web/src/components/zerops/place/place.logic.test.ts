import type { FlowReleaseRow } from "@t3tools/client-runtime/zerops";
import type { StopServiceRow, StopView } from "@t3tools/client-runtime/zerops/flow";
import type { ZeropsServiceRow } from "@t3tools/client-runtime/zerops/serviceMap";
import { describe, expect, it } from "vite-plus/test";

import {
  environmentTitle,
  foldedFaces,
  placeAddress,
  placeServiceRows,
  placeStatus,
  placeTitle,
  rollBackTarget,
  stopRowSays,
} from "./place.logic";

const version = (
  over: Partial<NonNullable<StopView["version"]>> = {},
): NonNullable<StopView["version"]> => ({
  name: "v0.1.0",
  commit: "b41b723",
  sha: "b41b723",
  taggedBy: undefined,
  label: "v0.1.0",
  ...over,
});

describe("a place's head names it, says what runs and links its primary address", () => {
  it.each([
    { name: "production", tier: "production", title: "Production", tag: undefined },
    { name: "prod", tier: "production", title: "Production", tag: undefined },
    { name: "stage", tier: "stage", title: "Stage", tag: undefined },
    { name: "Tea Shop live", tier: "production", title: "Tea Shop live", tag: "prod" },
    { name: "preview-eu", tier: "stage", title: "preview-eu", tag: "stage" },
  ] as const)("$name ($tier) reads $title", ({ name, tier, title, tag }) => {
    expect(placeTitle(name, tier)).toEqual({ title, tag });
  });

  it.each<{
    readonly case: string;
    readonly input: Parameters<typeof placeStatus>[0];
    readonly text: string;
  }>([
    {
      case: "a running production says its release, when and by whom, and its services",
      input: {
        tier: "production",
        view: { tone: "good", word: "Deployed", version: version({ taggedBy: "Mira" }) },
        releasedAge: "3h ago",
        source: "release",
        services: 1,
      },
      text: "Running · v0.1.0 · released 3h ago by Mira · 1 service",
    },
    {
      case: "a running production whose release says no maker leaves the name out",
      input: {
        tier: "production",
        view: { tone: "good", word: "Deployed", version: version() },
        releasedAge: "3h ago",
        source: "release",
        services: 6,
      },
      text: "Running · v0.1.0 · released 3h ago · 6 services",
    },
    {
      case: "a deployed stage says since when, its commit and the branch it follows",
      input: {
        tier: "stage",
        view: {
          tone: "good",
          word: "Deployed",
          version: version({ name: undefined, label: "6bc9923", commit: "6bc9923" }),
        },
        since: "23m ago",
        source: "main",
        services: 1,
      },
      text: "Running · deployed 23m ago · 6bc9923 · follows main · 1 service",
    },
    {
      case: "a stage being deployed keeps its own word",
      input: {
        tier: "stage",
        view: {
          tone: "pending",
          word: "Deploying…",
          version: version({ name: undefined, label: "6bc9923", commit: "6bc9923" }),
        },
        source: "main",
        services: 2,
      },
      text: "Deploying… · 6bc9923 · follows main · 2 services",
    },
    {
      case: "a failed production keeps its own word",
      input: {
        tier: "production",
        view: { tone: "bad", word: "Failed", version: version() },
        source: "release",
        services: 1,
      },
      text: "Failed · v0.1.0 · 1 service",
    },
    {
      case: "a stage nothing runs on says so once",
      input: {
        tier: "stage",
        view: { tone: "neutral", word: "Nothing deployed yet", version: undefined },
        source: "—",
        services: 0,
      },
      text: "Not deployed yet",
    },
  ])("$case", ({ input, text }) => {
    expect(placeStatus(input).text).toBe(text);
  });

  const SUBDOMAIN = { host: "app-7c1e-3000.prg1.zerops.app" };
  const DOMAIN = { host: "teashop.example" };
  const WWW = { host: "www.teashop.example" };
  it.each([
    ["production prefers its own domain", "production", [SUBDOMAIN, DOMAIN, WWW], DOMAIN],
    ["production without a domain links its subdomain", "production", [SUBDOMAIN], SUBDOMAIN],
    ["a stage links its subdomain", "stage", [DOMAIN, SUBDOMAIN], SUBDOMAIN],
    ["a stage without a subdomain links what it has", "stage", [DOMAIN], DOMAIN],
    ["a place serving nothing links nothing", "production", [], undefined],
  ] as const)("%s", (_case, tier, routes, expected) => {
    expect(placeAddress(tier, routes)).toBe(expected);
  });
});

const codeRow = (hostname: string, repository: string) =>
  ({ hostname, repository }) as unknown as StopServiceRow;

const platformRow = (
  hostname: string,
  type: string,
  typeShort: string,
  portLabel?: string,
  isControlPlane = false,
) =>
  ({
    isControlPlane,
    service: { hostname, type },
    typeShort,
    typeLabel: type,
    ...(portLabel === undefined ? {} : { portLabel }),
  }) as unknown as ZeropsServiceRow;

describe("a place's services, as one table", () => {
  const platform = [
    platformRow("zcp", "zcp@1", "Zerops Control Plane", undefined, true),
    platformRow("db", "postgresql@17", "PostgreSQL 17", ":5432, :6432"),
    platformRow("nextstore", "nodejs@22", "Node.js 22", ":8000"),
    platformRow("medusa", "nodejs@22", "Node.js 22", ":9000"),
    platformRow("storage", "object-storage", "Object storage"),
    platformRow("files", "shared-storage", "Shared storage"),
  ];
  const rows = placeServiceRows(
    [codeRow("medusa", "beviro-medusa"), codeRow("nextstore", "beviro-store")],
    platform,
  );

  it("lists the code services first, then everything else the place runs but the control plane", () => {
    expect(rows.map((row) => row.hostname)).toEqual([
      "medusa",
      "nextstore",
      "db",
      "storage",
      "files",
    ]);
  });

  it("names a code service's repository under it, and another service's ports", () => {
    expect(rows.map((row) => [row.hostname, row.under, row.type])).toEqual([
      ["medusa", "beviro-medusa", "Node.js 22"],
      ["nextstore", "beviro-store", "Node.js 22"],
      ["db", ":5432, :6432", "PostgreSQL 17"],
      ["storage", undefined, "Object storage"],
      ["files", undefined, "Shared storage"],
    ]);
  });

  it("a service without compute shows no meters", () => {
    expect(rows.filter((row) => !row.compute).map((row) => row.hostname)).toEqual([
      "storage",
      "files",
    ]);
  });

  it("keeps the code services while the platform's listing is not read", () => {
    expect(
      placeServiceRows([codeRow("app", "appdev")], undefined).map((row) => [
        row.hostname,
        row.under,
        row.compute,
      ]),
    ).toEqual([["app", "appdev", true]]);
  });
});

describe("access folds to its faces until opened", () => {
  it.each([
    [15, 8, 8, 7],
    [3, 8, 3, 0],
    [0, 8, 0, 0],
  ])("%i people, %i shown: %i faces and %i more", (count, shown, faces, more) => {
    const people = Array.from({ length: count }, (_, index) => index);
    const fold = foldedFaces(people, shown);
    expect(fold.faces).toHaveLength(faces);
    expect(fold.more).toBe(more);
  });
});

describe("rollback is offered from the production page, never the project's road", () => {
  const release = (tag: string, rollBack: boolean) => ({ tag, rollBack }) as FlowReleaseRow;
  it.each([
    [
      "the newest release offered",
      [release("v0.1.59", false), release("v0.1.58", true)],
      "v0.1.58",
    ],
    ["none where only the live one stands", [release("v0.1.0", false)], undefined],
  ] as const)("%s", (_case, releases, tag) => {
    expect(rollBackTarget(releases)).toBe(tag);
  });
});

// The live audit (2026-10-28): the project page's column said "Nothing depl…" and "Deployed" where
// its cards said "Not released yet" and "Running".
describe("an environment's row on its project's page", () => {
  it.each<{
    readonly case: string;
    readonly tier: "production" | "stage";
    readonly view: Pick<StopView, "tone" | "word" | "line">;
    readonly says: ReturnType<typeof stopRowSays>;
  }>([
    {
      case: "a running production",
      tier: "production",
      view: { tone: "good", word: "Deployed", line: "v0.1.4" },
      says: { version: "v0.1.4", word: "Running", tone: "good" },
    },
    {
      case: "a running stage",
      tier: "stage",
      view: { tone: "good", word: "Deployed", line: "dc3837a" },
      says: { version: "dc3837a", word: "Running", tone: "good" },
    },
    {
      case: "a production nothing was released to",
      tier: "production",
      view: { tone: "neutral", word: "Nothing deployed yet", line: "Nothing deployed yet" },
      says: { version: undefined, word: "Not released yet", tone: "neutral" },
    },
    {
      case: "a stage nothing was deployed to",
      tier: "stage",
      view: { tone: "neutral", word: "Nothing deployed yet", line: "Nothing deployed yet" },
      says: { version: undefined, word: "Not deployed yet", tone: "neutral" },
    },
    {
      case: "a production whose deploy failed",
      tier: "production",
      view: { tone: "bad", word: "Failed", line: "v0.1.3" },
      says: { version: "v0.1.3", word: "Release failed", tone: "bad" },
    },
    {
      case: "a stage being deployed",
      tier: "stage",
      view: { tone: "pending", word: "Deploying…", line: "6bc9923" },
      says: { version: "6bc9923", word: "Deploying…", tone: "pending" },
    },
    {
      case: "a stage whose answer is still read",
      tier: "stage",
      view: { tone: "neutral", word: "Checking what runs here…", line: "Checking what runs here…" },
      says: { version: undefined, word: "Checking what runs here…", tone: undefined },
    },
  ])("An environment's row says its state in its card's words: $case", ({ tier, view, says }) => {
    expect(stopRowSays(tier, view)).toEqual(says);
  });
});

describe("a shared environment's title", () => {
  it.each([
    { tier: "production", name: "demo-app-production", title: "Production" },
    { tier: "production", name: "production", title: "Production" },
    { tier: "stage", name: "stage", title: "Stage" },
    { tier: "stage", name: "client demo", title: "Client demo" },
    { tier: "stage", name: "demo-app-stage", title: "Stage" },
  ] as const)("names $tier $name as $title", ({ tier, name, title }) => {
    expect(environmentTitle(tier, name)).toBe(title);
  });
});
