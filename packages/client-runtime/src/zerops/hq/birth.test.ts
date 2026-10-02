import { describe, expect, it } from "@effect/vitest";

import { ZeropsApiError, type ZeropsOrganizationMember, type ZeropsService } from "../api.ts";
import type { ZeropsProjectCreationRecord } from "../projectCreation.ts";
import type { HqHealth } from "./client.ts";
import {
  HQ_BIRTH_START,
  runHqBirth,
  type HqBirthDeps,
  type HqBirthPlatform,
  type HqBirthRecord,
} from "./birth.ts";

const ORG = "org-1";
/** The HQ project's own domain, as the platform names it. */
const PUBLIC_ZONE = "qapsmj4u3rd3n03jj4au6r13i40.prg1-zerops.zone";
const ADDRESS = `https://${PUBLIC_ZONE}`;

interface Token {
  readonly id: string;
  readonly name: string;
  readonly roleCode: string;
  readonly projects: ReadonlyArray<unknown>;
  value: string;
}

/**
 * Zerops as a birth meets it: an import that makes the three services, which come up after a
 * few reads; a routing of the project's domain whose certificate turns active a few reads after
 * its sync; tokens that show in the member list; a deploy whose process finishes after a few
 * reads. `fail` makes one call throw once.
 */
function fakeZerops(
  options: {
    readonly members?: ReadonlyArray<ZeropsOrganizationMember>;
    /** The domain's certificate never turns active, the platform saying why. */
    readonly sslError?: string;
    /** The organization's project creations, as its process history names them. */
    readonly creations?: ReadonlyArray<ZeropsProjectCreationRecord>;
  } = {},
) {
  const calls: string[] = [];
  const tokens: Token[] = [];
  const env = new Map<string, string>();
  const imports: string[] = [];
  /** What an import makes: a project's three services, coming up. */
  const imported = (): ZeropsService[] => [
    { id: "svc-db", name: "db", status: "CREATING" },
    { id: "svc-vol", name: "vol", status: "CREATING" },
    { id: "svc-hq", name: "hq", status: "CREATING" },
  ];
  // A creation the history names stands already, though no answer said so.
  let services: ZeropsService[] = (options.creations ?? []).length > 0 ? imported() : [];
  let reads = 0;
  let processReads = 0;
  let minted = 0;
  let routing: {
    id: string;
    isSynced: boolean;
    domain: string;
    sslStatus: string;
    reads: number;
  } | null = null;
  const failures = new Map<string, unknown>();
  const step = (name: string) => {
    calls.push(name);
    const failure = failures.get(name);
    if (failure !== undefined) {
      failures.delete(name);
      throw failure;
    }
  };
  const tokenMember = (token: Token): ZeropsOrganizationMember => ({
    id: `member-${token.id}`,
    roleCode: token.roleCode,
    status: "ACTIVE",
    user: { fullName: token.name, email: `token-${token.id}@zerops.io` },
  });
  const platform: HqBirthPlatform = {
    listProjectCreations: async () => {
      step("creations");
      return options.creations ?? [];
    },
    listOrganizationMembers: async () => {
      step("members");
      return [...(options.members ?? []), ...tokens.map(tokenMember)];
    },
    listIntegrationTokens: async () => {
      step("tokens");
      return tokens.map(({ id, name, roleCode, projects }) => ({
        id,
        name,
        roleCode,
        projects: projects as never,
      }));
    },
    importProject: async (clientId, yaml) => {
      step("import");
      expect(clientId).toBe(ORG);
      imports.push(yaml);
      services = imported();
      return { projectId: "hq1" };
    },
    listProjectServices: async () => {
      step("services");
      reads += 1;
      if (reads >= 2) services = services.map((service) => ({ ...service, status: "ACTIVE" }));
      return services;
    },
    fetchProject: async (projectId) => {
      step("project");
      return {
        id: projectId,
        name: "Headquarters",
        status: "ACTIVE",
        publicZone: PUBLIC_ZONE,
      };
    },
    mintIntegrationToken: async (input) => {
      step(`mint ${input.name} ${input.roleCode}`);
      expect(input.projects).toEqual([]);
      const token = {
        id: `t${++minted}`,
        name: input.name,
        roleCode: input.roleCode,
        projects: [],
        value: `value-${minted}`,
      };
      tokens.push(token);
      return { id: token.id, token: token.value };
    },
    regenerateIntegrationToken: async ({ tokenId }) => {
      step(`regenerate ${tokenId}`);
      const token = tokens.find((entry) => entry.id === tokenId)!;
      token.value = `${token.value}-again`;
      return token.value;
    },
    listServiceVariableNames: async () => {
      step("env");
      return [...env.keys()];
    },
    writeServiceSecret: async ({ serviceId, key, content }) => {
      step(`secret ${serviceId} ${key}`);
      env.set(key, content);
    },
    createAppVersion: async (serviceId) => {
      step(`app-version ${serviceId}`);
      return { id: "av-1" };
    },
    uploadAppVersionArchive: async (_id, archive) => {
      step(`upload ${archive.byteLength}`);
    },
    buildAndDeployAppVersion: async (_id, input) => {
      step(`deploy ${input.setup}`);
      processReads = 0;
      return { processId: "process-1" };
    },
    readProcessStatus: async (processId) => {
      step(`process ${processId}`);
      if (processId === "process-sync") return "FINISHED";
      processReads += 1;
      return processReads >= 2 ? "FINISHED" : "RUNNING";
    },
    listPublicHttpRoutings: async () => {
      step("routings");
      if (routing === null) return [];
      if (routing.isSynced) routing.reads += 1;
      if (routing.isSynced && routing.reads >= 2 && options.sslError === undefined) {
        routing.sslStatus = "ACTIVE";
      }
      return [
        {
          id: routing.id,
          isSynced: routing.isSynced,
          domains: [
            {
              domainName: routing.domain,
              sslStatus: routing.sslStatus,
              sslError: options.sslError,
            },
          ],
        },
      ];
    },
    createPublicHttpRouting: async (_projectId, input) => {
      const location = input.locations[0]!;
      step(
        `route ${input.domains.join(",")} -> ${location.serviceStackId}:${location.port}${location.path}`,
      );
      routing = {
        id: "routing-1",
        isSynced: false,
        domain: input.domains[0]!,
        sslStatus: "WAITING_FOR_DNS",
        reads: 0,
      };
    },
    syncPublicHttpRouting: async () => {
      step("sync");
      if (routing !== null) routing.isSynced = true;
      return { processId: "process-sync" };
    },
  };
  return {
    platform,
    calls,
    tokens,
    env,
    imports,
    failOnce: (call: string, cause: unknown) => failures.set(call, cause),
  };
}

function deps(
  zerops: ReturnType<typeof fakeZerops>,
  health: () => HqHealth = () => ({ kind: "healthy", build: "b1" }),
): HqBirthDeps {
  let now = 0;
  return {
    platform: zerops.platform,
    core: async () => ({ archive: new Uint8Array(7), zeropsYaml: "zerops:\n  - setup: hq\n" }),
    health: async (address) => {
      expect(address).toBe(ADDRESS);
      return health();
    },
    sleep: async (ms) => {
      now += ms;
    },
    now: () => now,
  };
}

const INPUT = {
  clientId: ORG,
  userId: "u-ada",
  origins: ["http://localhost:4380", "https://mate.zerops.io"],
  zeropsApi: "https://api.app-prg1.zerops.io/api/rest/public",
};

async function birth(
  record: HqBirthRecord,
  zerops: ReturnType<typeof fakeZerops>,
  d = deps(zerops),
) {
  const patches: Array<Partial<HqBirthRecord>> = [];
  let held = record;
  const outcome = await runHqBirth({
    ...INPUT,
    record,
    deps: d,
    moved: (patch) => {
      patches.push(patch);
      held = { ...held, ...patch };
    },
  });
  return { outcome, patches, record: held };
}

describe("runHqBirth", () => {
  it("stands HQ up from nothing: import, services, anchor, credential, Core, official", async () => {
    const zerops = fakeZerops();
    const { outcome, record } = await birth(HQ_BIRTH_START, zerops);

    expect(outcome).toEqual({ ok: true, hq: { projectId: "hq1", address: ADDRESS } });
    expect(record).toEqual({
      step: "done",
      importAskedAt: null,
      projectId: "hq1",
      serviceId: "svc-hq",
      address: ADDRESS,
      deployProcessId: "process-1",
    });
    expect(zerops.calls).toEqual([
      "members",
      "import",
      "services",
      "services",
      // HQ's address is its project's own domain, routed to Core with SSL before anything names it.
      "project",
      "routings",
      `route ${PUBLIC_ZONE} -> svc-hq:8080/`,
      "routings",
      "sync",
      "process process-sync",
      "routings",
      "routings",
      "members",
      "tokens",
      `mint mate-hq:hq1:${ADDRESS} ADMIN`,
      "env",
      "tokens",
      "mint mate-hq-org:hq1 READ_ONLY",
      "secret svc-hq HQ_ORG_TOKEN",
      "app-version svc-hq",
      "upload 7",
      "deploy hq",
      "process process-1",
      "process process-1",
    ]);
    // The anchor's value is dropped; the working token's is HQ's own secret and nothing else's.
    expect([...zerops.env]).toEqual([["HQ_ORG_TOKEN", "value-2"]]);
    const yaml = zerops.imports[0]!;
    expect(yaml).toContain("name: Headquarters");
    expect(yaml).toContain('- "mate:hq"');
    expect(yaml).toMatch(/hostname: hq\n/u);
    expect(yaml).not.toMatch(/hostname: core\b/u);
    expect(yaml).not.toContain("enableSubdomainAccess");
    expect(yaml).toContain('HQ_CLIENT_ORIGINS: "http://localhost:4380,https://mate.zerops.io"');
    expect(yaml).toContain('HQ_ZEROPS_API: "https://api.app-prg1.zerops.io/api/rest/public"');
  });

  it("names the step that stopped, and Try again resumes there without making anything twice", async () => {
    const zerops = fakeZerops();
    zerops.failOnce(
      "deploy hq",
      new ZeropsApiError("Network error contacting Zerops: offline", "network"),
    );
    const first = await birth(HQ_BIRTH_START, zerops);
    expect(first.outcome).toEqual({
      ok: false,
      step: "deploy",
      reason: "Network error contacting Zerops: offline",
      uncertain: false,
    });
    expect(first.record.step).toBe("deploy");

    zerops.calls.length = 0;
    const again = await birth(first.record, zerops);
    expect(again.outcome).toMatchObject({ ok: true });
    expect(zerops.calls.filter((call) => /^(import|mint|secret)/u.test(call))).toEqual([]);
    expect(zerops.calls[0]).toBe("app-version svc-hq");
  });

  it.each<[string, ReadonlyArray<ZeropsOrganizationMember>]>([
    [
      "an official HQ",
      [
        {
          id: "m1",
          roleCode: "ADMIN",
          status: "ACTIVE",
          user: { fullName: `mate-hq:other:${ADDRESS}`, email: "token-x@zerops.io" },
        },
      ],
    ],
    [
      "an anchor not active yet",
      [
        {
          id: "m1",
          roleCode: "ADMIN",
          status: "PENDING",
          user: { fullName: `mate-hq:other:${ADDRESS}`, email: "token-x@zerops.io" },
        },
      ],
    ],
  ])("is never born over %s the member list names", async (_name, members) => {
    const zerops = fakeZerops({ members });
    const { outcome } = await birth(HQ_BIRTH_START, zerops);
    expect(outcome).toEqual({
      ok: false,
      step: "project",
      reason: "This organization has an HQ already.",
      uncertain: false,
    });
    expect(zerops.calls).toEqual(["members"]);
  });

  it("stops uncertain only when the import's answer was lost: a second one could make two projects", async () => {
    const zerops = fakeZerops();
    zerops.failOnce(
      "import",
      new ZeropsApiError("Zerops may have accepted this operation.", "uncertain"),
    );
    const { outcome } = await birth(HQ_BIRTH_START, zerops);
    expect(outcome).toMatchObject({ ok: false, step: "project", uncertain: true });

    // Every later step reads before it writes: its lost answer is one Try again settles.
    const later = fakeZerops();
    later.failOnce(
      "secret svc-hq HQ_ORG_TOKEN",
      new ZeropsApiError("Zerops may have accepted this operation.", "uncertain"),
    );
    expect((await birth(HQ_BIRTH_START, later)).outcome).toMatchObject({
      ok: false,
      step: "credential",
      uncertain: false,
    });
  });

  /** An import asked at 05:00 whose answer this birth never read. */
  const ASKED_AT = Date.parse("2026-10-02T05:00:00.000Z");
  const creation = (
    over: Partial<ZeropsProjectCreationRecord> = {},
  ): ZeropsProjectCreationRecord => ({
    projectId: "hq1",
    projectName: "Headquarters",
    createdAt: ASKED_AT + 1_000,
    createdByUserId: "u-ada",
    ...over,
  });

  it("takes up the Headquarters this person's import made after it was asked, and imports nothing", async () => {
    const zerops = fakeZerops({ creations: [creation()] });
    const { outcome, record } = await birth({ ...HQ_BIRTH_START, importAskedAt: ASKED_AT }, zerops);
    expect(outcome).toMatchObject({ ok: true, hq: { projectId: "hq1" } });
    expect(record).toMatchObject({ projectId: "hq1", importAskedAt: null });
    expect(zerops.calls).not.toContain("import");
  });

  it.each<[string, ReadonlyArray<ZeropsProjectCreationRecord>]>([
    ["none in the history yet", []],
    ["another person's", [creation({ createdByUserId: "u-jan" })]],
    ["one made before the import was asked", [creation({ createdAt: ASKED_AT - 10 * 60_000 })]],
    ["a project of another name", [creation({ projectName: "Headquarters 2" })]],
    ["one of two", [creation(), creation({ projectId: "hq2" })]],
  ])("never imports again over an unanswered import, nor takes up %s", async (_name, creations) => {
    const zerops = fakeZerops({ creations });
    const { outcome } = await birth({ ...HQ_BIRTH_START, importAskedAt: ASKED_AT }, zerops);
    expect(outcome).toEqual({
      ok: false,
      step: "project",
      reason:
        "Zerops did not confirm HQ's project, and its history shows no Headquarters of yours made since. Try again in a moment; before starting over, look for a Headquarters project in Zerops and delete it.",
      uncertain: true,
    });
    expect(zerops.calls).not.toContain("import");
  });

  it("takes up its project at once where the import's answer was lost and the history names it", async () => {
    const zerops = fakeZerops({ creations: [creation({ createdAt: 1_000 })] });
    zerops.failOnce(
      "import",
      new ZeropsApiError("Zerops may have accepted this operation.", "uncertain"),
    );
    const { outcome } = await birth(HQ_BIRTH_START, zerops);
    expect(outcome).toMatchObject({ ok: true, hq: { projectId: "hq1" } });
    expect(zerops.calls.filter((call) => call === "import")).toHaveLength(1);
  });

  it("keeps an import that failed outright for one never made: Try again imports", async () => {
    const zerops = fakeZerops();
    zerops.failOnce(
      "import",
      new ZeropsApiError("Network error contacting Zerops: offline", "network"),
    );
    const first = await birth(HQ_BIRTH_START, zerops);
    expect(first.outcome).toMatchObject({ ok: false, step: "project", uncertain: false });
    expect(first.record).toMatchObject({ step: "project", importAskedAt: null });
    expect((await birth(first.record, zerops)).outcome).toMatchObject({ ok: true });
    expect(zerops.imports).toHaveLength(1);
  });

  it("marks the import asked before it is sent, and answered once it is", async () => {
    const zerops = fakeZerops();
    const { patches } = await birth(HQ_BIRTH_START, zerops);
    expect(patches.slice(0, 2)).toEqual([
      { importAskedAt: 0 },
      { step: "services", importAskedAt: null, projectId: "hq1" },
    ]);
  });

  it("regenerates a working token whose variable is missing, and leaves a written one alone", async () => {
    const atCredential: HqBirthRecord = {
      step: "credential",
      importAskedAt: null,
      projectId: "hq1",
      serviceId: "svc-hq",
      address: ADDRESS,
      deployProcessId: null,
    };
    const zerops = fakeZerops();
    await zerops.platform.mintIntegrationToken({
      clientId: ORG,
      name: "mate-hq-org:hq1",
      roleCode: "READ_ONLY",
      projects: [],
    });
    zerops.calls.length = 0;
    const lost = await birth(atCredential, zerops);
    expect(lost.outcome).toMatchObject({ ok: true });
    expect(zerops.calls.slice(0, 4)).toEqual([
      "env",
      "tokens",
      "regenerate t1",
      "secret svc-hq HQ_ORG_TOKEN",
    ]);
    expect(zerops.env.get("HQ_ORG_TOKEN")).toBe("value-1-again");

    zerops.calls.length = 0;
    await birth(atCredential, zerops);
    expect(zerops.calls[0]).toBe("env");
    expect(zerops.calls[1]).toBe("app-version svc-hq");
  });

  it("deploys anew on Try again after a deploy that failed", async () => {
    const zerops = fakeZerops();
    const atDeploy: HqBirthRecord = {
      step: "deploy",
      importAskedAt: null,
      projectId: "hq1",
      serviceId: "svc-hq",
      address: ADDRESS,
      deployProcessId: null,
    };
    const failing = { ...zerops.platform, readProcessStatus: async () => "FAILED" };
    const first = await birth(atDeploy, zerops, { ...deps(zerops), platform: failing });
    expect(first.outcome).toMatchObject({ ok: false, step: "deploy" });
    expect(first.record.deployProcessId).toBeNull();

    zerops.calls.length = 0;
    await birth(first.record, zerops);
    expect(zerops.calls.slice(0, 3)).toEqual(["app-version svc-hq", "upload 7", "deploy hq"]);
  });

  it("stops at ready when HQ never answers as the official one", async () => {
    const zerops = fakeZerops();
    const { outcome } = await birth(
      HQ_BIRTH_START,
      zerops,
      deps(zerops, () => ({ kind: "not-ready", state: "standby", official: "anchor_missing" })),
    );
    expect(outcome).toEqual({
      ok: false,
      step: "ready",
      reason: "HQ answering as this organization's HQ took too long.",
      uncertain: false,
    });
  });

  /** A birth whose services are up: what it does for HQ's domain. */
  const AT_DOMAIN: HqBirthRecord = {
    ...HQ_BIRTH_START,
    step: "domain",
    projectId: "hq1",
    serviceId: "svc-hq",
  };

  it("makes no second routing and syncs no more where the domain is routed and in place", async () => {
    const zerops = fakeZerops();
    await zerops.platform.createPublicHttpRouting("hq1", {
      domains: [PUBLIC_ZONE],
      locations: [{ path: "/", port: 8080, serviceStackId: "svc-hq" }],
    });
    await zerops.platform.syncPublicHttpRouting("hq1");
    zerops.calls.length = 0;
    const { outcome, record } = await birth(AT_DOMAIN, zerops);
    expect(outcome).toMatchObject({ ok: true, hq: { address: ADDRESS } });
    expect(record.address).toBe(ADDRESS);
    expect(zerops.calls.filter((call) => /^(route|sync)/u.test(call))).toEqual([]);
  });

  it("stops at the domain, saying why its certificate is not ready, where it never turns active", async () => {
    const zerops = fakeZerops({ sslError: "DNS for the domain does not resolve yet." });
    const { outcome, record } = await birth(AT_DOMAIN, zerops);
    expect(outcome).toEqual({
      ok: false,
      step: "domain",
      reason: `HQ's certificate for ${PUBLIC_ZONE} is not ready: DNS for the domain does not resolve yet.`,
      uncertain: false,
    });
    expect(record.address).toBeNull();
  });
});
