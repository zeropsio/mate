import type { ZeropsDevServer } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  mateParts,
  poolWorkspaceLink,
  type MatePart,
  type MatePartLease,
  type MatePartsInput,
} from "./mateParts.ts";

const route = (service: string, port = 80) => ({
  service,
  port,
  url: `https://${service}-1df2-${String(port)}.prg1.zerops.app`,
});

const server = (status: string, url?: string): ZeropsDevServer => ({
  name: "web",
  port: 3001,
  status,
  readAt: "2026-10-28T10:00:00Z",
  ...(url === undefined ? {} : { url }),
});

const lease = (alias: string, over: Partial<MatePartLease> = {}): MatePartLease => ({
  alias,
  pool: alias.replace(/-\d+$/u, ""),
  state: "held",
  ...over,
});

const running = (alias: string) =>
  lease(alias, {
    devServers: [
      server("running", `https://${alias.replace(/-/u, "-c2e4-")}-3001.prg1.zerops.app`),
    ],
  });

/**
 * A part as a row reads it: "dev service | dev entries | preview", each entry by its service's
 * hostname (a workspace's alias), then what it is for where that is not plain dev or preview.
 */
const text = ({ devService, dev, preview }: MatePart) => {
  const entry = (side: MatePart["dev"][number]) => {
    const what = side.label === "dev" || side.label === "preview" ? "" : ` · ${side.label}`;
    const where = side.url === undefined ? `(${String(side.why)})` : side.host;
    return `${side.service}${what} ${String(where)}`;
  };
  return `${devService} | ${dev.map(entry).join(", ")} | ${preview === undefined ? "" : entry(preview)}`;
};

const rows = (input: Partial<MatePartsInput>) =>
  mateParts({ services: [], routes: [], ...input }).parts.map(text);

const hostnames = (...names: ReadonlyArray<string>) => names.map((hostname) => ({ hostname }));

/** Noola's Odin after the move to dev pools: a repository holder the tier still pairs, a pool per part. */
const NOOLA_TIER = [
  "services:",
  "  - hostname: noola",
  "    type: go@1.22",
  "    zeropsSetup: dev",
  "    buildFromGit: https://hq.example.com/git/noola/noola",
  ...["api", "runner"].flatMap((part) => [
    `  - hostname: ${part}stage`,
    "    type: nodejs@22",
    `    zeropsSetup: ${part}prod`,
    "    buildFromGit: https://hq.example.com/git/noola/noola",
  ]),
  "",
].join("\n");

describe("a Mate's parts", () => {
  it.each<{ title: string; input: Partial<MatePartsInput>; rows: ReadonlyArray<string> }>([
    {
      title: "a plain dev service beside its stage",
      input: {
        services: hostnames("apidev", "apistage", "db"),
        routes: [route("apidev"), route("apistage")],
      },
      rows: [
        "apidev | apidev apidev-1df2-80.prg1.zerops.app | apistage apistage-1df2-80.prg1.zerops.app",
      ],
    },
    {
      title: "a pair whose dev half is the bare name",
      input: { services: hostnames("web", "webstage"), routes: [route("web"), route("webstage")] },
      rows: ["web | web web-1df2-80.prg1.zerops.app | webstage webstage-1df2-80.prg1.zerops.app"],
    },
    {
      title: "a pool beside its stage, by the pool's hostname, never the setup zcp names it by",
      input: {
        services: hostnames("boxpool", "boxstage"),
        routes: [route("boxpool", 3001), route("boxstage")],
        pools: ["boxpool"],
        poolPairs: [
          {
            pool: "boxpool",
            stages: [{ hostname: "boxstage", setup: "boxpreview", part: "boxpreview" }],
          },
        ],
        leases: [],
      },
      rows: ["boxpool |  | boxstage boxstage-1df2-80.prg1.zerops.app"],
    },
    {
      title:
        "a tier that pairs every stage with a repository holder yields each to the pool serving it",
      input: {
        services: hostnames("noola", "apipool", "apistage", "runnerpool", "runnerstage", "mailpit"),
        routes: [route("apistage"), route("mailpit", 8025)],
        pools: ["apipool", "runnerpool"],
        tier: NOOLA_TIER,
        leases: [running("apipool-1")],
      },
      rows: [
        "apipool | apipool-1 apipool-c2e4-1-3001.prg1.zerops.app | apistage apistage-1df2-80.prg1.zerops.app",
        "runnerpool |  | runnerstage (No web address.)",
      ],
    },
    {
      title: "a dev with no stage yet",
      input: { services: hostnames("matedev"), routes: [route("matedev")] },
      rows: ["matedev | matedev matedev-1df2-80.prg1.zerops.app | "],
    },
    {
      title: "a pool with neither a workspace nor a stage is no part",
      input: {
        services: hostnames("webpool"),
        routes: [route("webpool", 3001)],
        pools: ["webpool"],
        leases: [],
      },
      rows: [],
    },
    {
      title: "one dev serving several previews is a part per preview",
      input: {
        services: hostnames("appdev", "apistage", "webstage"),
        routes: [route("appdev"), route("apistage"), route("webstage")],
        tier: [
          "services:",
          ...[
            ["appdev", "dev"],
            ["webstage", "web"],
            ["apistage", "api"],
          ].flatMap(([hostname, setup]) => [
            `  - hostname: ${String(hostname)}`,
            "    type: nodejs@22",
            `    zeropsSetup: ${String(setup)}`,
            "    buildFromGit: https://hq.example.com/git/app/appdev",
          ]),
          "",
        ].join("\n"),
      },
      rows: [
        "appdev | appdev appdev-1df2-80.prg1.zerops.app | apistage apistage-1df2-80.prg1.zerops.app",
        "appdev | appdev appdev-1df2-80.prg1.zerops.app | webstage webstage-1df2-80.prg1.zerops.app",
      ],
    },
  ])(
    "a Mate's service shows its real hostname: a part is its dev and its preview, each by its own service: $title",
    ({ input, rows: expected }) => {
      expect(rows(input)).toEqual(expected);
    },
  );

  it.each<{ title: string; input: Partial<MatePartsInput>; dev: string }>([
    {
      title: "a dev service on three ports, its preview on one of them",
      input: {
        services: hostnames("shopdev", "shopstage"),
        routes: [
          route("shopdev", 5196),
          route("shopdev", 5193),
          route("shopdev", 5195),
          route("shopstage", 5195),
        ],
      },
      dev: "dev shopdev-1df2-5195.prg1.zerops.app +shopdev-1df2-5193.prg1.zerops.app +shopdev-1df2-5196.prg1.zerops.app",
    },
    {
      title: "a dev service whose preview opens none of its ports",
      input: {
        services: hostnames("shopdev", "shopstage"),
        routes: [route("shopdev", 5196), route("shopdev", 5193), route("shopstage")],
      },
      dev: "dev shopdev-1df2-5193.prg1.zerops.app +shopdev-1df2-5196.prg1.zerops.app",
    },
    {
      title: "a workspace running two dev servers",
      input: {
        services: hostnames("webpool"),
        pools: ["webpool"],
        leases: [
          lease("webpool-1", {
            devServers: [
              { ...server("running", "https://webpool-1-3001.prg1.zerops.app"), name: "web" },
              {
                ...server("running", "https://webpool-1-3002.prg1.zerops.app"),
                name: "",
                port: 3002,
              },
              { ...server("stopped", "https://webpool-1-3003.prg1.zerops.app"), name: "docs" },
            ],
          }),
        ],
      },
      dev: "dev webpool-1-3001.prg1.zerops.app +webpool-1-3002.prg1.zerops.app",
    },
  ])(
    "a dev on several addresses is one link, the one its preview opens, its other addresses in its tooltip: $title",
    ({ input, dev }) => {
      const [part] = mateParts({ services: [], routes: [], ...input }).parts;
      expect(
        part?.dev.map(
          (side) =>
            `${side.label} ${String(side.host)}${side.more.map((host) => ` +${host}`).join("")}`,
        ),
      ).toEqual([dev]);
    },
  );

  it.each<{ title: string; lease: MatePartLease; why: string }>([
    {
      title: "its server stopped",
      lease: lease("webpool-1", { devServers: [server("stopped")] }),
      why: "Not running.",
    },
    {
      title: "its server crashed",
      lease: lease("webpool-1", { devServers: [server("crashed")] }),
      why: "Not running.",
    },
    {
      title: "its server starting",
      lease: lease("webpool-1", { devServers: [server("starting")] }),
      why: "Starting.",
    },
    { title: "paused", lease: lease("webpool-1", { state: "parked" }), why: "Paused." },
    {
      title: "not confirmed yet",
      lease: lease("webpool-1", { unverified: true }),
      why: "Not confirmed yet.",
    },
    { title: "no server read on it", lease: lease("webpool-1"), why: "No web address yet." },
  ])(
    "a workspace with nothing to open says why in plain words: $title",
    ({ lease: given, why }) => {
      const [part] = mateParts({
        services: hostnames("webpool"),
        routes: [],
        pools: ["webpool"],
        leases: [given],
      }).parts;
      expect(part?.dev.map((entry) => entry.why)).toEqual([why]);
    },
  );

  it("a pool part lists one dev per workspace the Mate holds, by the chat it is for, else its branch, else dev — never numbered", () => {
    expect(
      rows({
        services: hostnames("hqpool", "hqstage"),
        routes: [route("hqpool", 3001), route("hqpool", 3002), route("hqstage")],
        pools: ["hqpool"],
        leases: [
          running("hqpool-3"),
          running("hqpool-1"),
          lease("hqpool-2", { state: "released" }),
          { ...running("hqpool-4"), branch: "build-stamp" },
          { ...running("hqpool-5"), branch: "main" },
        ],
        leaseChats: [{ alias: "hqpool-3", title: "Fix the login" }],
      }),
    ).toEqual([
      "hqpool | hqpool-1 hqpool-c2e4-1-3001.prg1.zerops.app, hqpool-3 · Fix the login hqpool-c2e4-3-3001.prg1.zerops.app, hqpool-4 · build-stamp hqpool-c2e4-4-3001.prg1.zerops.app, hqpool-5 hqpool-c2e4-5-3001.prg1.zerops.app | hqstage hqstage-1df2-80.prg1.zerops.app",
    ]);
  });

  it("a chat bound to a lease the pool handed out again is not what the workspace is for", () => {
    expect(
      rows({
        services: hostnames("webpool"),
        pools: ["webpool"],
        leases: [{ ...running("webpool-1"), acquiredAt: "2026-10-28T09:00:00Z" }],
        leaseChats: [{ alias: "webpool-1", acquiredAt: "2026-10-27T09:00:00Z", title: "Old work" }],
      }),
    ).toEqual(["webpool | webpool-1 webpool-c2e4-1-3001.prg1.zerops.app | "]);
  });

  // zcp's envelope marks a holder `standIn: { for: "pool-migrate" }`; the Zerops panel rests it.
  it.each<{ title: string; input: Partial<MatePartsInput>; rows: ReadonlyArray<string> }>([
    {
      title: "a holder beside its pools opens nothing: no link of its own, no part",
      input: {
        services: hostnames("kiln", "toolsdev", "apipool", "apistage"),
        routes: [route("kiln", 8080), route("toolsdev"), route("apistage")],
        pools: ["apipool"],
        standIns: ["kiln", "toolsdev"],
        leases: [],
      },
      rows: ["apipool |  | apistage apistage-1df2-80.prg1.zerops.app"],
    },
    {
      title: "a holder the tier still pairs a stage with keeps its preview, never its dev link",
      input: {
        services: hostnames("noola", "apipool", "apistage", "runnerstage"),
        routes: [route("noola"), route("apistage"), route("runnerstage")],
        pools: ["apipool"],
        standIns: ["noola"],
        tier: NOOLA_TIER,
        leases: [],
      },
      rows: [
        "apipool |  | apistage apistage-1df2-80.prg1.zerops.app",
        "noola |  | runnerstage runnerstage-1df2-80.prg1.zerops.app",
      ],
    },
    {
      title: "a stand-in before any pool stands is still where the code runs",
      input: {
        services: hostnames("toolsdev"),
        routes: [route("toolsdev")],
        standIns: ["toolsdev"],
      },
      rows: ["toolsdev | toolsdev toolsdev-1df2-80.prg1.zerops.app | "],
    },
  ])(
    "a holder zcp keeps for a repository holds the code; nothing runs there: $title",
    ({ input, rows: expected }) => {
      expect(rows(input)).toEqual(expected);
      expect(
        mateParts({ services: [], routes: [], ...input }).others.map((other) => other.service),
      ).toEqual([]);
    },
  );

  it("never lists a pool's slot routes, nor the control plane, and lists the rest by service", () => {
    const read = mateParts({
      services: hostnames("webpool", "webstage", "mailpit", "zcp"),
      routes: [route("webpool", 3001), route("webstage"), route("mailpit", 8025), route("zcp")],
      controlPlane: "zcp",
      pools: ["webpool"],
      leases: [],
    });
    expect(JSON.stringify(read)).not.toContain("webpool-1df2");
    expect(read.others.map((other) => other.service)).toEqual(["mailpit"]);
  });
});

describe("a pool workspace's link", () => {
  const URL = "https://webpool-c2e4-1-3001.prg1.zerops.app";
  it.each<{ title: string; lease: MatePartLease; link: { url?: string; why?: string } }>([
    {
      title: "held, verified, its server running: opens",
      lease: lease("webpool-1", { devServers: [server("running", URL)] }),
      link: { url: URL },
    },
    {
      title: "its server starting",
      lease: lease("webpool-1", { devServers: [server("starting", URL)] }),
      link: { why: "starting" },
    },
    {
      title: "its server crashed",
      lease: lease("webpool-1", { devServers: [server("crashed", URL)] }),
      link: { why: "stopped: crashed" },
    },
    {
      title: "its server stopped",
      lease: lease("webpool-1", { devServers: [server("stopped", URL)] }),
      link: { why: "stopped" },
    },
    {
      title: "parked",
      lease: lease("webpool-1", { state: "parked", devServers: [server("running", URL)] }),
      link: { why: "paused" },
    },
    {
      title: "not confirmed by its pool",
      lease: lease("webpool-1", { unverified: true, devServers: [server("running", URL)] }),
      link: { why: "not confirmed by its pool" },
    },
    {
      title: "no server read on it",
      lease: lease("webpool-1"),
      link: { why: "no address yet" },
    },
    {
      title: "an address that is no web address",
      lease: lease("webpool-1", { devServers: [server("running", "javascript:alert(1)")] }),
      link: { why: "no address yet" },
    },
  ])(
    "a workspace opens only while held, confirmed and running: $title",
    ({ lease: given, link }) => {
      const read = poolWorkspaceLink(given);
      expect(read.url === undefined ? { why: read.why } : { url: read.url }).toEqual(link);
    },
  );

  it("a lease the newest envelope no longer lists shows nothing", () => {
    expect(rows({ services: hostnames("webpool"), pools: ["webpool"], leases: [] })).toEqual([]);
  });
});
