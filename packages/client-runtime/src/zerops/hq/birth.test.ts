import { describe, expect, it } from "@effect/vitest";

import { ZeropsApiError, type ZeropsOrganizationMember, type ZeropsService } from "../api.ts";
import type { HqHealth } from "./client.ts";
import {
  HQ_BIRTH_START,
  runHqBirth,
  type HqBirthDeps,
  type HqBirthPlatform,
  type HqBirthRecord,
} from "./birth.ts";

const ORG = "org-1";
const ADDRESS = "https://hq-30db-8080.prg1.zerops.app";

interface Token {
  readonly id: string;
  readonly name: string;
  readonly roleCode: string;
  readonly projects: ReadonlyArray<unknown>;
  value: string;
}

/**
 * Zerops as a birth meets it: an import that makes the three services, which come up after a
 * few reads; tokens that show in the member list; a deploy whose process finishes after a few
 * reads. `fail` makes one call throw once.
 */
function fakeZerops(
  options: {
    readonly members?: ReadonlyArray<ZeropsOrganizationMember>;
    /** The platform refuses the subdomain while no code is deployed. */
    readonly subdomainNeedsCode?: boolean;
  } = {},
) {
  const calls: string[] = [];
  const tokens: Token[] = [];
  const env = new Map<string, string>();
  const imports: string[] = [];
  let services: ZeropsService[] = [];
  let reads = 0;
  let processReads = 0;
  let minted = 0;
  let deployed = false;
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
      services = [
        { id: "svc-db", name: "db", status: "CREATING" },
        { id: "svc-vol", name: "vol", status: "CREATING" },
        { id: "svc-hq", name: "hq", status: "CREATING", subdomainAccess: false },
      ];
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
        zeropsSubdomainHost: "30db",
        publicZone: "qapsmj4u3rd3n03jj4au6r13i40.prg1-zerops.zone",
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
    readProcessStatus: async () => {
      step("process");
      processReads += 1;
      deployed = processReads >= 2;
      return deployed ? "FINISHED" : "RUNNING";
    },
    enableSubdomainAccess: async (serviceId) => {
      step(`subdomain ${serviceId}`);
      if (options.subdomainNeedsCode === true && !deployed) {
        throw new ZeropsApiError("The service has no code yet.", "invalid-input", 400);
      }
      services = services.map((service) =>
        service.id === serviceId ? { ...service, subdomainAccess: true } : service,
      );
    },
    restartService: async (serviceId) => {
      step(`restart ${serviceId}`);
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
      // Core names itself by its subdomain at boot: it is on before Core is deployed.
      "subdomain svc-hq",
      "project",
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
      "process",
      "process",
      "services",
    ]);
    // The anchor's value is dropped; the working token's is HQ's own secret and nothing else's.
    expect([...zerops.env]).toEqual([["HQ_ORG_TOKEN", "value-2"]]);
    const yaml = zerops.imports[0]!;
    expect(yaml).toContain("name: Headquarters");
    expect(yaml).toContain('- "mate:hq"');
    expect(yaml).toMatch(/hostname: hq\n/u);
    expect(yaml).not.toMatch(/hostname: core\b/u);
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

  it("regenerates a working token whose variable is missing, and leaves a written one alone", async () => {
    const atCredential: HqBirthRecord = {
      step: "credential",
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

  it("publishes Core after its deploy where the platform refuses it before, and restarts it to read its address", async () => {
    const zerops = fakeZerops({ subdomainNeedsCode: true });
    const { outcome } = await birth(HQ_BIRTH_START, zerops);

    expect(outcome).toMatchObject({ ok: true });
    expect(
      zerops.calls.filter((call) => /^(subdomain|restart|deploy|app-version)/u.test(call)),
    ).toEqual([
      "subdomain svc-hq",
      "app-version svc-hq",
      "deploy hq",
      "subdomain svc-hq",
      "restart svc-hq",
    ]);
  });
});
