import { describe, expect, it } from "@effect/vitest";

import {
  ZeropsApiError,
  type ZeropsOrganizationMember,
  type ZeropsProject,
  type ZeropsService,
} from "../api.ts";
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
    /** Core was deployed before the birth reads anything. */
    readonly coreDeployed?: boolean;
    /** The organization's projects before the birth reads anything. */
    readonly projects?: ReadonlyArray<ZeropsProject>;
    /** The import is carried out, and its answer never reaches the birth: this is thrown instead. */
    readonly importAnswerLost?: unknown;
    /** How many builds Zerops refuses while the service's variables still sync. */
    readonly variablesSyncing?: number;
    /** How many variable writes Zerops refuses while the import's variables still sync. */
    readonly importVariablesSyncing?: number;
  } = {},
) {
  const calls: string[] = [];
  const projects: ZeropsProject[] = [...(options.projects ?? [])];
  const tokens: Token[] = [];
  const env = new Map<string, string>();
  const imports: string[] = [];
  /** What an import makes: a project's three services, coming up. */
  const imported = (): ZeropsService[] => [
    { id: "svc-db", name: "db", status: "CREATING" },
    { id: "svc-vol", name: "vol", status: "CREATING" },
    { id: "svc-hq", name: "hq", status: "CREATING" },
  ];
  // A project that stands already has its services, though no answer said so.
  let services: ZeropsService[] = projects.length > 0 ? imported() : [];
  let reads = 0;
  let processReads = 0;
  /** Core is deployed: `hq` has its HTTP port, and a routing may name it. */
  let deployed = options.coreDeployed === true;
  let minted = 0;
  let versions = 0;
  let syncing = options.variablesSyncing ?? 0;
  let importSyncing = options.importVariablesSyncing ?? 0;
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
    listClientProjects: async (clientId) => {
      step("projects");
      expect(clientId).toBe(ORG);
      return projects;
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
      // The direct read lists a project before its import has answered.
      const tagList = [...yaml.matchAll(/^    - "(.+)"$/gmu)].map((tag) => tag[1]!);
      projects.push({ id: "hq1", name: "Headquarters", status: "ACTIVE", tagList });
      if (options.importAnswerLost !== undefined) throw options.importAnswerLost;
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
      if (importSyncing > 0) {
        importSyncing -= 1;
        throw new ZeropsApiError(
          "Service environment variable synchronization is already running.",
          "invalid-input",
          400,
          "userDataSyncRunning",
        );
      }
      env.set(key, content);
    },
    createAppVersion: async (serviceId) => {
      step(`app-version ${serviceId}`);
      return { id: `av-${String(++versions)}` };
    },
    uploadAppVersionArchive: async (id, archive) => {
      step(`upload ${id} ${archive.byteLength}`);
    },
    buildAndDeployAppVersion: async (id, input) => {
      step(`deploy ${id} ${input.setup}`);
      if (syncing > 0) {
        syncing -= 1;
        // Measured in Mate s.r.o., 2026-10-03: the build right after HQ_ORG_TOKEN was written.
        throw new ZeropsApiError(
          "Service environment variable synchronization is already running.",
          "invalid-input",
          400,
          "userDataSyncRunning",
        );
      }
      processReads = 0;
      return { processId: "process-1" };
    },
    readProcessStatus: async (processId) => {
      step(`process ${processId}`);
      if (processId === "process-sync") return "FINISHED";
      processReads += 1;
      deployed = deployed || processReads >= 2;
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
      if (!deployed) {
        // Measured in KRLS, 2026-10-02: a fresh import's `hq` has no HTTP port before Core's deploy.
        throw new ZeropsApiError("ServiceStack must supported http protocol", "invalid-input", 400);
      }
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
    newBirthId: () => "b1",
  };
}

const INPUT = {
  clientId: ORG,
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
  it("stands HQ up from nothing: import, services, access, Core, its domain, anchor, official", async () => {
    const zerops = fakeZerops();
    const { outcome, record } = await birth(HQ_BIRTH_START, zerops);

    expect(outcome).toEqual({ ok: true, hq: { projectId: "hq1", address: ADDRESS } });
    expect(record).toEqual({
      step: "done",
      importTag: "mate:hq-birth:b1",
      projectId: "hq1",
      serviceId: "svc-hq",
      address: ADDRESS,
      appVersionId: "av-1",
      deployProcessId: "process-1",
    });
    expect(zerops.calls).toEqual([
      "members",
      "projects",
      "import",
      "services",
      "services",
      // Core gets its access and is deployed first: it starts as a standby, its anchor missing.
      "env",
      "tokens",
      "mint mate-hq-org:hq1 READ_ONLY",
      "secret svc-hq HQ_ORG_TOKEN",
      "app-version svc-hq",
      "upload av-1 7",
      "deploy av-1 hq",
      "process process-1",
      "process process-1",
      // Its HTTP port open, HQ's address is its project's own domain, routed to Core with SSL…
      "project",
      "routings",
      `route ${PUBLIC_ZONE} -> svc-hq:8080/`,
      "routings",
      "sync",
      "process process-sync",
      "routings",
      "routings",
      // …and only an address that serves is named as the organization's HQ.
      "members",
      "tokens",
      `mint mate-hq:hq1:${ADDRESS} ADMIN`,
    ]);
    // The anchor's value is dropped; the working token's is HQ's own secret and nothing else's.
    expect([...zerops.env]).toEqual([["HQ_ORG_TOKEN", "value-1"]]);
    const yaml = zerops.imports[0]!;
    expect(yaml).toContain("name: Headquarters");
    expect(yaml).toContain('- "mate:hq"\n    - "mate:hq-birth:b1"\n');
    expect(yaml).toMatch(/hostname: hq\n/u);
    expect(yaml).not.toMatch(/hostname: core\b/u);
    expect(yaml).not.toContain("enableSubdomainAccess");
    expect(yaml).toContain('HQ_CLIENT_ORIGINS: "http://localhost:4380,https://mate.zerops.io"');
    expect(yaml).toContain('HQ_ZEROPS_API: "https://api.app-prg1.zerops.io/api/rest/public"');
    // Backup sets go to a private bucket of HQ's own, which Core reaches by the service's variables.
    expect(yaml).toContain(
      "  - hostname: backup\n    type: objectstorage\n    objectStorageSize: 80\n    objectStoragePolicy: private\n",
    );
    for (const [name, variable] of [
      ["URL", "apiUrl"],
      ["KEY_ID", "accessKeyId"],
      ["SECRET", "secretAccessKey"],
      ["BUCKET", "bucketName"],
      ["QUOTA_GB", "quotaGBytes"],
    ]) {
      expect(yaml).toContain(`      HQ_BACKUP_${name}: \${backup_${variable}}\n`);
    }
  });

  it("names the step that stopped, and Try again resumes there without making anything twice", async () => {
    const zerops = fakeZerops();
    zerops.failOnce(
      "deploy av-1 hq",
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
    // Nothing before the deploy is made again; the anchor comes after it, once.
    expect(zerops.calls.filter((call) => /^(import|mint|secret)/u.test(call))).toEqual([
      `mint mate-hq:hq1:${ADDRESS} ADMIN`,
    ]);
    // The version it uploaded is built: none is made and left behind.
    expect(zerops.calls[0]).toBe("deploy av-1 hq");
    expect(zerops.calls.filter((call) => /^(app-version|upload)/u.test(call))).toEqual([]);
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

  it.each<[string, ReadonlyArray<string>]>([
    // KRLS, 2026-10-02 05:40: a page imported, its kept record went, and the next page imported a
    // second Headquarters 2 s after the first.
    ["by a build before birth tags", ["mate:hq"]],
    ["by another birth", ["mate:hq", "mate:hq-birth:another"]],
  ])(
    "imports nothing while a Headquarters made %s stands without an anchor",
    async (_n, tagList) => {
      const zerops = fakeZerops({
        projects: [
          { id: "CYJDpyAOQf6CCe6l9qDxkA", name: "Headquarters", status: "ACTIVE", tagList },
        ],
      });
      const { outcome } = await birth(HQ_BIRTH_START, zerops);
      expect(outcome).toEqual({
        ok: false,
        step: "project",
        reason:
          "This organization has a Headquarters project already (CYJDpyAOQf6CCe6l9qDxkA) that is not its HQ yet: HQ is being set up elsewhere, or a setup stopped. Finish it where it started, or delete that project in Zerops and try again.",
        uncertain: false,
      });
      expect(zerops.imports).toEqual([]);
    },
  );

  /** A birth whose import was sent with its tag, the answer never read. */
  const SENT: HqBirthRecord = { ...HQ_BIRTH_START, importTag: "mate:hq-birth:b0" };
  const listed = (over: Partial<ZeropsProject> = {}): ZeropsProject => ({
    id: "hq1",
    name: "Headquarters",
    status: "ACTIVE",
    tagList: ["mate:hq", "mate:hq-birth:b0"],
    ...over,
  });

  it("takes up the one project its birth's tag names, and imports nothing", async () => {
    const zerops = fakeZerops({ projects: [listed()] });
    const { outcome, record } = await birth(SENT, zerops);
    expect(outcome).toMatchObject({ ok: true, hq: { projectId: "hq1" } });
    expect(record).toMatchObject({ projectId: "hq1", importTag: "mate:hq-birth:b0" });
    expect(zerops.imports).toEqual([]);
  });

  it.each<[string, ReadonlyArray<ZeropsProject>]>([
    ["none listed yet", []],
    ["another birth's", [listed({ tagList: ["mate:hq", "mate:hq-birth:other"] })]],
    ["one going away", [listed({ status: "DELETING" })]],
    ["one no longer tagged mate:hq", [listed({ tagList: ["mate:hq-birth:b0"] })]],
    ["one of two", [listed(), listed({ id: "hq2" })]],
  ])("never imports again over a sent import, nor takes up %s", async (_name, projects) => {
    const zerops = fakeZerops({ projects });
    const { outcome, record } = await birth(SENT, zerops);
    expect(outcome).toEqual({
      ok: false,
      step: "project",
      reason:
        "Zerops did not confirm HQ's project, and lists none of this setup's. Try again in a moment; before starting over, look for a Headquarters project in Zerops and delete it.",
      uncertain: true,
    });
    expect(record).toEqual(SENT);
    expect(zerops.imports).toEqual([]);
  });

  it.each<[string, unknown]>([
    ["lost", new ZeropsApiError("Zerops may have accepted this operation.", "uncertain")],
    // The client drops an answer that comes back after its session moved on.
    [
      "dropped as the session moved",
      new ZeropsApiError("This account session has ended.", "expired-session", 401),
    ],
    ["unreadable", new SyntaxError("Unexpected end of JSON input")],
  ])(
    "takes up the project its import made where the answer was %s, and sends it once",
    async (_name, answer) => {
      const zerops = fakeZerops({ importAnswerLost: answer });
      const { outcome } = await birth(HQ_BIRTH_START, zerops);
      expect(outcome).toMatchObject({ ok: true, hq: { projectId: "hq1" } });
      expect(zerops.imports).toHaveLength(1);
    },
  );

  it.each<[string, ZeropsApiError]>([
    ["invalid", new ZeropsApiError("Insufficient credit.", "invalid-input", 400)],
    ["forbidden", new ZeropsApiError("Not allowed.", "forbidden", 403)],
  ])("knows an import Zerops refused (%s) made nothing: Try again imports", async (_n, refusal) => {
    const zerops = fakeZerops();
    zerops.failOnce("import", refusal);
    const first = await birth(HQ_BIRTH_START, zerops);
    expect(first.outcome).toEqual({
      ok: false,
      step: "project",
      reason: refusal.message,
      uncertain: false,
    });
    expect(first.record).toEqual(HQ_BIRTH_START);
    expect((await birth(first.record, zerops)).outcome).toMatchObject({ ok: true });
    expect(zerops.imports).toHaveLength(1);
  });

  it("keeps its birth's tag before the import is sent, and the import carries it", async () => {
    const zerops = fakeZerops();
    const kept: Array<readonly [Partial<HqBirthRecord>, number]> = [];
    await runHqBirth({
      ...INPUT,
      record: HQ_BIRTH_START,
      deps: deps(zerops),
      moved: (patch) => kept.push([patch, zerops.imports.length]),
    });
    expect(kept.slice(0, 2)).toEqual([
      [{ importTag: "mate:hq-birth:b1" }, 0],
      [{ step: "services", projectId: "hq1" }, 1],
    ]);
    expect(zerops.imports[0]).toContain('  tags:\n    - "mate:hq"\n    - "mate:hq-birth:b1"\n');
  });

  it("regenerates a working token whose variable is missing, and leaves a written one alone", async () => {
    const atCredential: HqBirthRecord = {
      step: "credential",
      importTag: "mate:hq-birth:b1",
      projectId: "hq1",
      serviceId: "svc-hq",
      address: ADDRESS,
      appVersionId: null,
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

  // Mate s.r.o., 2026-10-03: the build right after Core's token was written was refused, 400
  // userDataSyncRunning, while the service's variables synced.
  it("waits out a variable sync its build is refused for, and builds the one version it uploaded", async () => {
    const zerops = fakeZerops({ variablesSyncing: 2 });
    const { outcome, record } = await birth(HQ_BIRTH_START, zerops);
    expect(outcome).toMatchObject({ ok: true });
    expect(zerops.calls.filter((call) => /^(app-version|upload|deploy)/u.test(call))).toEqual([
      "app-version svc-hq",
      "upload av-1 7",
      "deploy av-1 hq",
      "deploy av-1 hq",
      "deploy av-1 hq",
    ]);
    expect(record.deployProcessId).toBe("process-1");
  });

  it("stops at once, in Zerops' words, where its build is refused for anything else", async () => {
    const zerops = fakeZerops();
    zerops.failOnce(
      "deploy av-1 hq",
      new ZeropsApiError(
        "Invalid zerops.yml: setup hq not found.",
        "invalid-input",
        400,
        "zeropsYamlInvalidParameter",
      ),
    );
    const { outcome, record } = await birth(HQ_BIRTH_START, zerops);
    expect(outcome).toEqual({
      ok: false,
      step: "deploy",
      reason: "Invalid zerops.yml: setup hq not found.",
      uncertain: false,
    });
    expect(zerops.calls.filter((call) => call.startsWith("deploy "))).toEqual(["deploy av-1 hq"]);
    expect(record.appVersionId).toBe("av-1");
  });

  it("stops where the variables still sync past the deploy's wait, keeping the version it uploaded", async () => {
    const zerops = fakeZerops({ variablesSyncing: Number.POSITIVE_INFINITY });
    const { outcome, record } = await birth(HQ_BIRTH_START, zerops);
    expect(outcome).toEqual({
      ok: false,
      step: "deploy",
      reason: "Zerops was still syncing HQ's variables. Try again in a minute.",
      uncertain: false,
    });
    expect(record).toMatchObject({ appVersionId: "av-1", deployProcessId: null });
    expect(zerops.calls.filter((call) => /^(app-version|upload)/u.test(call))).toEqual([
      "app-version svc-hq",
      "upload av-1 7",
    ]);
  });

  // The import's own variables (its `envSecrets`) may still sync when Core's token is written.
  it("waits out a variable sync its token's write is refused for, minting the token once", async () => {
    const zerops = fakeZerops({ importVariablesSyncing: 2 });
    const { outcome } = await birth(HQ_BIRTH_START, zerops);
    expect(outcome).toMatchObject({ ok: true });
    expect(
      zerops.calls.filter((call) => /^(mint mate-hq-org|regenerate|secret)/u.test(call)),
    ).toEqual([
      "mint mate-hq-org:hq1 READ_ONLY",
      "secret svc-hq HQ_ORG_TOKEN",
      "secret svc-hq HQ_ORG_TOKEN",
      "secret svc-hq HQ_ORG_TOKEN",
    ]);
    expect(zerops.env.get("HQ_ORG_TOKEN")).toBe("value-1");
  });

  it("deploys anew on Try again after a deploy that failed", async () => {
    const zerops = fakeZerops();
    const atDeploy: HqBirthRecord = {
      step: "deploy",
      importTag: "mate:hq-birth:b1",
      projectId: "hq1",
      serviceId: "svc-hq",
      address: ADDRESS,
      appVersionId: null,
      deployProcessId: null,
    };
    const failing = { ...zerops.platform, readProcessStatus: async () => "FAILED" };
    const first = await birth(atDeploy, zerops, { ...deps(zerops), platform: failing });
    expect(first.outcome).toMatchObject({ ok: false, step: "deploy" });
    expect(first.record.deployProcessId).toBeNull();
    expect(first.record.appVersionId).toBeNull();

    zerops.calls.length = 0;
    await birth(first.record, zerops);
    expect(zerops.calls.slice(0, 3)).toEqual([
      "app-version svc-hq",
      "upload av-2 7",
      "deploy av-2 hq",
    ]);
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
    deployProcessId: "process-1",
    projectId: "hq1",
    serviceId: "svc-hq",
  };

  it("deploys Core first where a birth stopped at the domain with no Core deployed behind it", async () => {
    // Headquarters in KRLS, 2026-10-02: a build that routed the domain before Core's deploy stopped
    // there with 400 "ServiceStack must supported http protocol".
    const zerops = fakeZerops();
    const { outcome } = await birth({ ...AT_DOMAIN, deployProcessId: null }, zerops);
    expect(outcome).toMatchObject({ ok: true, hq: { address: ADDRESS } });
    const order = zerops.calls.filter((call) => /^(secret|deploy|route|mint mate-hq:)/u.test(call));
    expect(order).toEqual([
      "secret svc-hq HQ_ORG_TOKEN",
      "deploy av-1 hq",
      `route ${PUBLIC_ZONE} -> svc-hq:8080/`,
      `mint mate-hq:hq1:${ADDRESS} ADMIN`,
    ]);
  });

  it("makes no second routing and syncs no more where the domain is routed and in place", async () => {
    const zerops = fakeZerops({ coreDeployed: true });
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
    const zerops = fakeZerops({
      sslError: "DNS for the domain does not resolve yet.",
      coreDeployed: true,
    });
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
