import { describe, expect, it } from "vite-plus/test";

import { recipeTierServices } from "./recipeTier.ts";
import { isStageHostname, previewLabel, servicePairs, type ServicePair } from "./servicePairs.ts";

/** A Mate tier on `main` as zcp composes it: each runtime with its setup and its repository. */
const tier = (
  runtimes: ReadonlyArray<{ hostname: string; setup: string; repository: string }>,
): string =>
  [
    "services:",
    "  - hostname: db",
    "    type: postgresql@17",
    ...runtimes.flatMap(({ hostname, setup, repository }) => [
      `  - hostname: ${hostname}`,
      "    type: nodejs@22",
      `    zeropsSetup: ${setup}`,
      `    buildFromGit: https://hq.example.com/git/app-1/${repository}`,
    ]),
    "",
  ].join("\n");

const runtimes = (...hostnames: ReadonlyArray<string>) =>
  hostnames.map((hostname) => ({ hostname, group: "runtimes" as const }));

const SINGLE_TIER = tier([
  { hostname: "appdev", setup: "dev", repository: "appdev" },
  { hostname: "appstage", setup: "prod", repository: "appdev" },
]);

const THREE_PART_TIER = tier([
  { hostname: "appdev", setup: "dev", repository: "appdev" },
  { hostname: "webstage", setup: "web", repository: "appdev" },
  { hostname: "apistage", setup: "api", repository: "appdev" },
  { hostname: "workerstage", setup: "worker", repository: "appdev" },
]);

describe("servicePairs", () => {
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly input: Parameters<typeof servicePairs>[0];
    readonly pairs: ReadonlyArray<ServicePair>;
  }> = [
    {
      name: "today's single pair pairs `appstage` with `appdev` by its stem",
      input: { services: [...runtimes("appdev", "appstage"), { hostname: "db", group: "data" }] },
      pairs: [
        {
          name: "app",
          dev: "appdev",
          previews: [{ hostname: "appstage", setup: undefined, source: "stem" }],
        },
      ],
    },
    {
      name: "today's single pair reads the same from the tier on main, its setup beside it",
      input: { services: runtimes("appdev", "appstage"), tier: SINGLE_TIER },
      pairs: [
        {
          name: "app",
          dev: "appdev",
          previews: [{ hostname: "appstage", setup: "prod", source: "tier" }],
        },
      ],
    },
    {
      name: "a single service zcp expanded into a pair keeps its hostname as the dev half",
      input: { services: runtimes("todoapp", "todoappstage") },
      pairs: [
        {
          name: "todoapp",
          dev: "todoapp",
          previews: [{ hostname: "todoappstage", setup: undefined, source: "stem" }],
        },
      ],
    },
    {
      name: "a 3-part tier pairs every preview with the one dev service that builds them",
      input: {
        services: runtimes("appdev", "webstage", "apistage", "workerstage"),
        tier: THREE_PART_TIER,
      },
      pairs: [
        {
          name: "app",
          dev: "appdev",
          previews: [
            { hostname: "webstage", setup: "web", source: "tier" },
            { hostname: "apistage", setup: "api", source: "tier" },
            { hostname: "workerstage", setup: "worker", source: "tier" },
          ],
        },
      ],
    },
    {
      name: "a preview the open recipe change adds and main lacks waits for recipe approval",
      input: {
        services: runtimes("appdev", "webstage", "apistage", "workerstage"),
        tier: tier([
          { hostname: "appdev", setup: "dev", repository: "appdev" },
          { hostname: "webstage", setup: "web", repository: "appdev" },
          { hostname: "apistage", setup: "api", repository: "appdev" },
        ]),
        proposal: THREE_PART_TIER,
      },
      pairs: [
        {
          name: "app",
          dev: "appdev",
          previews: [
            { hostname: "webstage", setup: "web", source: "tier" },
            { hostname: "apistage", setup: "api", source: "tier" },
            { hostname: "workerstage", setup: "worker", source: "recipe" },
          ],
        },
      ],
    },
    {
      name: "a pair only the open recipe change proposes, with no tier on main yet, waits too",
      input: { services: runtimes("appdev", "appstage"), proposal: SINGLE_TIER },
      pairs: [
        {
          name: "app",
          dev: "appdev",
          previews: [{ hostname: "appstage", setup: "prod", source: "recipe" }],
        },
      ],
    },
    {
      name: "the tier pairs a preview its stem would never name (`apistage` beside `backenddev`)",
      input: {
        services: runtimes("backenddev", "apistage"),
        tier: tier([
          { hostname: "backenddev", setup: "dev", repository: "backenddev" },
          { hostname: "apistage", setup: "prod", repository: "backenddev" },
        ]),
      },
      pairs: [
        {
          name: "backend",
          dev: "backenddev",
          previews: [{ hostname: "apistage", setup: "prod", source: "tier" }],
        },
      ],
    },
    {
      name: "pairing by hostname stem still pairs a pair zcp has not proposed to a tier",
      input: {
        services: runtimes("appdev", "appstage", "docsdev", "docsstage"),
        tier: SINGLE_TIER,
      },
      pairs: [
        {
          name: "app",
          dev: "appdev",
          previews: [{ hostname: "appstage", setup: "prod", source: "tier" }],
        },
        {
          name: "docs",
          dev: "docsdev",
          previews: [{ hostname: "docsstage", setup: undefined, source: "stem" }],
        },
      ],
    },
    {
      name: "a tier service the project does not hold pairs nothing",
      input: { services: runtimes("appdev"), tier: SINGLE_TIER },
      pairs: [],
    },
    {
      name: "pairing is within a group: a `cachestage` data service is no runtime's stage half",
      input: {
        services: [...runtimes("cachedev"), { hostname: "cachestage", group: "data" }],
      },
      pairs: [],
    },
    {
      name: "a pool is no dev half: `poolstage` beside `pool` pairs nothing",
      input: {
        services: [
          { hostname: "pool", group: "runtimes", type: "swarm@1" },
          { hostname: "poolstage", group: "runtimes", type: "ubuntu/python@3.12" },
        ],
      },
      pairs: [],
    },
    {
      name: "a pool is no preview half either",
      input: {
        services: [
          { hostname: "appdev", group: "runtimes", type: "ubuntu/python@3.12" },
          { hostname: "appstage", group: "runtimes", type: "swarm-vm@1" },
        ],
      },
      pairs: [],
    },
    {
      name: "a Box is neither half, even beside a `…stage` of its own group",
      input: {
        services: [
          { hostname: "boxdev", group: "data", type: "ubuntu/zbox@1" },
          { hostname: "boxstage", group: "data", type: "ubuntu/zbox@1" },
        ],
      },
      pairs: [],
    },
    {
      name: "a tier that declares a pool as a runtime pairs nothing for it",
      input: {
        services: [
          { hostname: "appdev", group: "runtimes", type: "swarm@1" },
          { hostname: "appstage", group: "runtimes", type: "ubuntu/nodejs@22" },
        ],
        tier: SINGLE_TIER,
      },
      pairs: [],
    },
    {
      name: "a `…stage` with no dev half beside it is a service somebody named that way",
      input: { services: runtimes("docsstage") },
      pairs: [],
    },
  ];

  it.each(cases)("$name", ({ input, pairs }) => {
    expect(servicePairs(input).pairs).toEqual(pairs);
  });

  it("names each preview's dev half, and nothing else", () => {
    const pairing = servicePairs({
      services: runtimes("appdev", "webstage", "apistage", "mail"),
      tier: THREE_PART_TIER,
    });
    expect([...pairing.devOf]).toEqual([
      ["webstage", "appdev"],
      ["apistage", "appdev"],
    ]);
  });
});

describe("servicePairs — literal names", () => {
  it.each([
    { case: "`dev` beside `stage`", hostnames: ["dev", "stage"], devOf: [["stage", "dev"]] },
    {
      case: "`x` beside `xdev` and `xstage`",
      hostnames: ["x", "xdev", "xstage"],
      devOf: [["xstage", "xdev"]],
    },
    { case: "a lone `stage` has no dev half", hostnames: ["stage"], devOf: [] },
  ])("pairs $case", ({ hostnames, devOf }) => {
    expect([...servicePairs({ services: runtimes(...hostnames) }).devOf]).toEqual(devOf);
  });

  it("every site names a runtime `stage` a stage half", () => {
    expect(isStageHostname("stage")).toBe(true);
    const services = recipeTierServices(tier([{ hostname: "stage", setup: "p", repository: "r" }]));
    expect(services?.find((service) => service.hostname === "stage")?.role).toBe("stage");
  });
});

describe("previewLabel", () => {
  it("a part is labelled by its preview's zeropsSetup only when the pair has more than one part", () => {
    const [single] = servicePairs({
      services: runtimes("appdev", "appstage"),
      tier: SINGLE_TIER,
    }).pairs;
    const [three] = servicePairs({
      services: runtimes("appdev", "webstage", "apistage", "workerstage"),
      tier: THREE_PART_TIER,
    }).pairs;
    expect(single!.previews.map((preview) => previewLabel(single!, preview))).toEqual([undefined]);
    expect(three!.previews.map((preview) => previewLabel(three!, preview))).toEqual([
      "web",
      "api",
      "worker",
    ]);
  });
});
