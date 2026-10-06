import { describe, expect, it } from "@effect/vitest";

import { HQ_BIRTH_SLOT_TAKEN } from "../../data/operations/hqBirth.ts";
import type { RunToEnd } from "../../data/operations/runToEnd.ts";
import type { OperationIntent } from "../../data/model.ts";
import { ZeropsApiError } from "../api.ts";
import {
  HQ_BIRTH_START,
  hqImportYaml,
  runHqBirth,
  type HqBirthDeps,
  type HqBirthRecord,
} from "./birth.ts";
import { birthSnapshot, HQ_BIRTH_CLAIM_MS } from "./birthJournal.ts";

const ORG = "org-1";
/** The HQ project's own domain, as the platform names it. */
const PUBLIC_ZONE = "qapsmj4u3rd3n03jj4au6r13i40.prg1-zerops.zone";
const ADDRESS = `https://${PUBLIC_ZONE}`;
const SEED_KEY = "MATE_HQ_BIRTH_RECORD_0";

/**
 * Zerops as a birth meets it through the account: each write an operation run to its end, each
 * wait a fact, the journal read executor-side. `failOnce` makes one write throw once; a process's
 * end is what `ends` says, else FINISHED.
 */
function fakeZerops(
  world: {
    /** The project the member list marks as HQ. */
    readonly marked?: string;
    /** A project that looks like HQ's but holds no record. */
    readonly unrecorded?: boolean;
    /** The import is carried out, and its answer never reaches the birth: this is thrown instead. */
    readonly importAnswerLost?: unknown;
  } = {},
) {
  const writes: string[] = [];
  /** Each project's env journal. */
  const env = new Map<string, Map<string, string>>();
  const failures = new Map<string, unknown>();
  const ends = new Map<string, string>();
  const waited: string[] = [];
  let processes = 0;
  const imported = (yaml: string) => {
    const projectId = `hq${env.size + 1}`;
    const seed = /MATE_HQ_BIRTH_RECORD_0: (.*)$/mu.exec(yaml)![1]!;
    env.set(projectId, new Map([[SEED_KEY, JSON.parse(seed) as string]]));
    return projectId;
  };
  const run = (async (intent: OperationIntent, options: Parameters<RunToEnd>[1]) => {
    const name = describeWrite(intent);
    if (intent.kind !== "hq-birth-note") writes.push(name);
    const failure = failures.get(name);
    if (failure !== undefined) {
      failures.delete(name);
      throw failure;
    }
    switch (intent.kind) {
      case "hq-birth-note": {
        const journal = env.get(intent.projectId)!;
        if (journal.has(intent.key)) throw new Error(HQ_BIRTH_SLOT_TAKEN);
        journal.set(intent.key, intent.content);
        return undefined;
      }
      case "import-project": {
        const projectId = imported(intent.yaml);
        if (world.importAnswerLost !== undefined) throw world.importAnswerLost;
        return { projectId };
      }
      case "hq-org-token":
        return { tokenId: "tok-org" };
      case "hq-update": {
        const processId = `deploy-${++processes}`;
        options.accepted?.({ processId } as never);
        return { processId };
      }
      case "route-hq-domain": {
        const processId = `sync-${++processes}`;
        options.accepted?.({ processId } as never);
        return { processId };
      }
      case "mark-official-hq":
        return { tokenId: "tok-anchor" };
      default:
        return undefined;
    }
  }) as unknown as RunToEnd;
  const zerops = {
    writes,
    env,
    waited,
    ends,
    failOnce: (name: string, failure: unknown) => failures.set(name, failure),
    journal: (projectId = "hq1") => env.get(projectId)!,
    deps: (now = { at: 0 }, id = "b1"): HqBirthDeps => ({
      run,
      reads: {
        journal: async (projectId) => new Map(env.get(projectId) ?? []),
        births: async () => ({
          underway: [...env].flatMap(([projectId, journal]) => {
            let last: string | undefined;
            let index = -1;
            for (const [key, content] of journal) {
              const match = /^MATE_HQ_BIRTH_RECORD_(\d+)$/u.exec(key);
              if (match !== null && Number(match[1]) > index) {
                index = Number(match[1]);
                last = content;
              }
            }
            const record = (JSON.parse(last!) as { record: HqBirthRecord }).record;
            return record.step === "done" ? [] : [{ projectId, record }];
          }),
          unrecorded: world.unrecorded === true,
        }),
        markedHq: async () =>
          world.marked === undefined
            ? { kind: "none" }
            : { kind: "official", projectId: world.marked, address: "https://other" },
      },
      waits: {
        untilServices: async (_orgId, projectId) => {
          waited.push(`services ${projectId}`);
          const stop = failures.get("services");
          if (stop !== undefined) {
            failures.delete("services");
            throw stop;
          }
          return {
            serviceId: "svc-hq",
            serviceIds: { db: "svc-db", vol: "svc-vol", hq: "svc-hq" },
          };
        },
        untilZone: async () => {
          waited.push("zone");
          return PUBLIC_ZONE;
        },
        untilProcessEnds: async (_orgId, _projectId, processId) => {
          waited.push(`process ${processId}`);
          return ends.get(processId) ?? "FINISHED";
        },
      },
      now: () => now.at,
      newBirthId: () => id,
    }),
  };
  return zerops;
}

function describeWrite(intent: OperationIntent): string {
  switch (intent.kind) {
    case "import-project":
      return "import";
    case "hq-org-token":
      return `org-token ${intent.serviceId}`;
    case "hq-key-secret":
      return `key-secret ${intent.serviceId}`;
    case "hq-update":
      return `deploy ${intent.serviceId}`;
    case "route-hq-domain":
      return `route ${intent.domain} -> ${intent.serviceId}`;
    case "mark-official-hq":
      return `mark ${intent.projectId} ${intent.address}`;
    case "hq-birth-note":
      return `note ${intent.key}`;
    default:
      return intent.kind;
  }
}

const INPUT = {
  clientId: ORG,
  zeropsApi: "https://api.app-prg1.zerops.io/api/rest/public",
};

async function birth(
  record: HqBirthRecord,
  zerops: ReturnType<typeof fakeZerops>,
  options: { readonly again?: boolean; readonly deps?: HqBirthDeps } = {},
) {
  const patches: Array<Partial<HqBirthRecord>> = [];
  let held = record;
  const outcome = await runHqBirth({
    ...INPUT,
    record,
    deps: options.deps ?? zerops.deps(),
    again: options.again === true,
    moved: (patch) => {
      patches.push(patch);
      held = { ...held, ...patch };
    },
  });
  return { outcome, patches, record: held };
}

/** HQ's project already imported, its journal seeded with `record`. */
function seeded(zerops: ReturnType<typeof fakeZerops>, record: HqBirthRecord) {
  zerops.env.set("hq1", new Map([[SEED_KEY, birthSnapshot(record)]]));
  return { ...record, projectId: "hq1" };
}

const ALL_WRITES = [
  "import",
  "org-token svc-hq",
  "key-secret svc-hq",
  "deploy svc-hq",
  `route ${PUBLIC_ZONE} -> svc-hq`,
  `mark hq1 ${ADDRESS}`,
];

describe("runHqBirth", () => {
  it("stands HQ up from nothing: import, services, access, Core, its domain, its mark", async () => {
    const zerops = fakeZerops();
    const { outcome, record } = await birth(HQ_BIRTH_START, zerops);

    expect(outcome).toEqual({ ok: true, hq: { projectId: "hq1", address: ADDRESS } });
    expect(record).toMatchObject({
      step: "done",
      importId: "b1",
      projectId: "hq1",
      serviceId: "svc-hq",
      address: ADDRESS,
      deployProcessId: "deploy-1",
      syncProcessId: "sync-2",
      orgTokenId: "tok-org",
      anchorTokenId: "tok-anchor",
    });
    // Core gets its access and is deployed first: it starts as a standby, its mark missing; only
    // an address in place is marked as the organization's HQ.
    expect(zerops.writes).toEqual(ALL_WRITES);
    expect(zerops.waited).toEqual(["services hq1", "process deploy-1", "zone", "process sync-2"]);
    // Each write's intent won its slot before it was sent, and its receipt holds its handles.
    expect(zerops.journal().get("MATE_HQ_BIRTH_ACTION_deploy_0_result")).toBe(
      JSON.stringify({ handles: { processId: "deploy-1" } }),
    );
  });

  it("imports a document that names Headquarters, its services, and the record of its own birth", () => {
    const yaml = hqImportYaml({ birthId: "b1", zeropsApi: INPUT.zeropsApi });
    expect(yaml).toContain("name: Headquarters");
    expect(yaml).toContain(`${SEED_KEY}: `);
    expect(yaml).toContain('\\"importId\\":\\"b1\\"');
    expect(yaml).not.toContain("  tags:");
    expect(yaml).toMatch(/hostname: hq\n/u);
    expect(yaml).not.toMatch(/hostname: core\b/u);
    expect(yaml).not.toContain("enableSubdomainAccess");
    // HQ answers any origin (bearer only), so a birth names none.
    expect(yaml).not.toContain("HQ_CLIENT_ORIGINS");
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

  it("names the step that stopped, and Again resumes there without making anything twice", async () => {
    const zerops = fakeZerops();
    zerops.failOnce("deploy svc-hq", new Error("Invalid zerops.yml: setup hq not found."));
    const first = await birth(HQ_BIRTH_START, zerops);
    expect(first.outcome).toEqual({
      ok: false,
      step: "deploy",
      reason: "Invalid zerops.yml: setup hq not found.",
      uncertain: false,
    });
    expect(first.record.step).toBe("deploy");

    zerops.writes.length = 0;
    const again = await birth(first.record, zerops, { again: true });
    expect(again.outcome).toMatchObject({ ok: true });
    // Nothing before the deploy is made again.
    expect(zerops.writes).toEqual(ALL_WRITES.slice(3));
  });

  it("is never born over a project the member list marks as HQ", async () => {
    const zerops = fakeZerops({ marked: "other" });
    const { outcome } = await birth(HQ_BIRTH_START, zerops);
    expect(outcome).toEqual({
      ok: false,
      step: "project",
      reason: "This organization has an HQ already.",
      uncertain: false,
    });
    expect(zerops.writes).toEqual([]);
  });

  it("stops uncertain for an unanswered write, and Again never sends it again", async () => {
    const zerops = fakeZerops();
    zerops.failOnce("org-token svc-hq", new ZeropsApiError("No answer.", "uncertain"));
    const first = await birth(HQ_BIRTH_START, zerops);
    expect(first.outcome).toEqual({
      ok: false,
      step: "credential",
      reason: "No answer.",
      uncertain: true,
    });
    zerops.writes.length = 0;
    const again = await birth(first.record, zerops, { again: true });
    expect(again.outcome).toMatchObject({ ok: false, step: "credential", uncertain: true });
    expect(zerops.writes).toEqual([]);
  });

  it("keeps its birth's tag before the import is sent, and takes up the one project it names", async () => {
    const zerops = fakeZerops({ importAnswerLost: new ZeropsApiError("No answer.", "uncertain") });
    const { outcome, patches } = await birth(HQ_BIRTH_START, zerops);
    expect(patches[0]).toEqual({ importId: "b1" });
    expect(outcome).toMatchObject({ ok: true, hq: { projectId: "hq1" } });
    expect(zerops.writes.filter((write) => write === "import")).toEqual(["import"]);
  });

  it("imports nothing again where its import may have landed and no project shows its tag", async () => {
    const zerops = fakeZerops();
    zerops.failOnce("import", new ZeropsApiError("No answer.", "uncertain"));
    const first = await birth(HQ_BIRTH_START, zerops);
    expect(first.outcome).toMatchObject({ ok: false, step: "project", uncertain: true });
    const again = await birth(first.record, zerops, { again: true });
    expect(again.outcome).toMatchObject({ ok: false, step: "project", uncertain: true });
    expect(zerops.writes).toEqual(["import"]);
  });

  it("takes up the birth under way that a fresh browser finds, importing nothing", async () => {
    const zerops = fakeZerops();
    seeded(zerops, { ...HQ_BIRTH_START, step: "services", importId: "b0" });
    const { outcome } = await birth(HQ_BIRTH_START, zerops);
    expect(outcome).toMatchObject({ ok: true, hq: { projectId: "hq1" } });
    expect(zerops.writes).toEqual(ALL_WRITES.slice(1));
  });

  it("stops where a project looks like HQ's but holds no record", async () => {
    const zerops = fakeZerops({ unrecorded: true });
    const { outcome } = await birth(HQ_BIRTH_START, zerops);
    expect(outcome).toEqual({
      ok: false,
      step: "project",
      reason:
        "Headquarters has no readable setup record. Ask an organization admin to inspect its project env in Zerops.",
      uncertain: false,
    });
    expect(zerops.writes).toEqual([]);
  });

  it("stops with Zerops's words where its services do not come up", async () => {
    const zerops = fakeZerops();
    zerops.failOnce(
      "services",
      new Error(
        "HQ's hq service is FAILED. Inspect its import process in Zerops, then press Again.",
      ),
    );
    const { outcome } = await birth(HQ_BIRTH_START, zerops);
    expect(outcome).toEqual({
      ok: false,
      step: "services",
      reason: "HQ's hq service is FAILED. Inspect its import process in Zerops, then press Again.",
      uncertain: false,
    });
    expect(zerops.writes).toEqual(["import"]);
  });

  it("deploys anew on Again after a deploy that failed", async () => {
    const zerops = fakeZerops();
    zerops.ends.set("deploy-1", "FAILED");
    const first = await birth(HQ_BIRTH_START, zerops);
    expect(first.outcome).toEqual({
      ok: false,
      step: "deploy",
      reason:
        "HQ's deploy did not finish. Its build log in Zerops says why. Fix the cause, then press Again.",
      uncertain: false,
    });
    expect(first.record.deployProcessId).toBeNull();
    const again = await birth(first.record, zerops, { again: true });
    expect(again.outcome).toMatchObject({ ok: true });
    expect(zerops.writes.filter((write) => write.startsWith("deploy"))).toEqual([
      "deploy svc-hq",
      "deploy svc-hq",
    ]);
  });

  it("deploys Core first where a birth stopped at the domain with no Core deployed behind it", async () => {
    const zerops = fakeZerops();
    const record = seeded(zerops, {
      ...HQ_BIRTH_START,
      step: "domain",
      importId: "b1",
      serviceId: "svc-hq",
    });
    const { outcome } = await birth({ ...record }, zerops);
    expect(outcome).toMatchObject({ ok: true });
    expect(zerops.writes).toEqual(ALL_WRITES.slice(1));
  });

  it("follows a recorded domain sync to its end without routing again", async () => {
    const zerops = fakeZerops();
    zerops.ends.set("sync-9", "FAILED");
    const record = seeded(zerops, {
      ...HQ_BIRTH_START,
      step: "domain",
      importId: "b1",
      serviceId: "svc-hq",
      deployProcessId: "deploy-0",
      syncProcessId: "sync-9",
    });
    const { outcome } = await birth(record, zerops);
    expect(outcome).toEqual({
      ok: false,
      step: "domain",
      reason:
        "Zerops could not put HQ's domain in place. Inspect its sync process in Zerops, then press Again.",
      uncertain: false,
    });
    expect(zerops.writes).toEqual([]);
    expect(zerops.waited).toEqual(["zone", "process sync-9"]);
  });
});

describe("HQ birth shared progress", () => {
  it("a new browser follows the project's recorded deploy handle, building nothing", async () => {
    const zerops = fakeZerops();
    const record = seeded(zerops, {
      ...HQ_BIRTH_START,
      step: "deploy",
      importId: "b1",
      serviceId: "svc-hq",
      deployProcessId: "deploy-7",
    });
    const { outcome } = await birth(HQ_BIRTH_START, zerops);
    expect(outcome).toMatchObject({ ok: true });
    expect(record.projectId).toBe("hq1");
    expect(zerops.writes).toEqual(ALL_WRITES.slice(4));
    expect(zerops.waited[0]).toBe("process deploy-7");
  });

  it("a definite credit refusal stops once, with the reason and the way on, and is recorded", async () => {
    const zerops = fakeZerops();
    zerops.failOnce("deploy svc-hq", new Error("Not enough credit"));
    const first = await birth(HQ_BIRTH_START, zerops);
    const reason =
      "Not enough credit. Ask an organization owner to add credit in Zerops, then press Again.";
    expect(first.outcome).toEqual({ ok: false, step: "deploy", reason, uncertain: false });
    // A fresh browser reads the recorded stop instead of trying the step again.
    zerops.writes.length = 0;
    const fresh = await birth(HQ_BIRTH_START, zerops, { deps: zerops.deps({ at: 0 }, "b2") });
    expect(fresh.outcome).toEqual({ ok: false, step: "deploy", reason, uncertain: false });
    expect(zerops.writes).toEqual([]);
  });

  it("an unanswered deploy is not sent again by the next browser", async () => {
    const zerops = fakeZerops();
    zerops.failOnce("deploy svc-hq", new ZeropsApiError("No answer.", "uncertain"));
    const first = await birth(HQ_BIRTH_START, zerops);
    expect(first.outcome).toMatchObject({ ok: false, step: "deploy", uncertain: true });
    zerops.writes.length = 0;
    const next = await birth(HQ_BIRTH_START, zerops, {
      again: true,
      deps: zerops.deps({ at: 0 }, "b2"),
    });
    expect(next.outcome).toMatchObject({
      ok: false,
      step: "deploy",
      reason: expect.stringContaining("Zerops has not confirmed HQ's deploy step."),
      uncertain: true,
    });
    expect(zerops.writes).toEqual([]);
  });

  it("a journal slot Zerops could not save prevents the next write", async () => {
    const zerops = fakeZerops();
    zerops.failOnce(
      "note MATE_HQ_BIRTH_ACTION_org_token_0",
      new Error(
        "Zerops could not save HQ's setup record (FAILED). Inspect its env process in Zerops, then press Again.",
      ),
    );
    const { outcome } = await birth(HQ_BIRTH_START, zerops);
    expect(outcome).toMatchObject({ ok: false, step: "credential", uncertain: false });
    expect(zerops.writes).toEqual(["import"]);
  });

  it("stops where HQ's project holds no setup record once its services are up", async () => {
    const zerops = fakeZerops();
    zerops.env.set("hq1", new Map());
    const { outcome } = await birth(
      { ...HQ_BIRTH_START, step: "services", projectId: "hq1" },
      zerops,
    );
    expect(outcome).toEqual({
      ok: false,
      step: "services",
      reason:
        "HQ's project has no setup record. Ask an organization admin to inspect it in Zerops.",
      uncertain: false,
    });
    expect(zerops.writes).toEqual([]);
  });
});

describe("HQ birth takeover", () => {
  it("a live claim of another browser stops this one at once; an expired one is taken over", async () => {
    const zerops = fakeZerops();
    const record = seeded(zerops, {
      ...HQ_BIRTH_START,
      step: "credential",
      importId: "b1",
      serviceId: "svc-hq",
    });
    zerops
      .journal()
      .set("MATE_HQ_BIRTH_CLAIM_0", JSON.stringify({ owner: "other", until: HQ_BIRTH_CLAIM_MS }));
    const held = await birth(record, zerops);
    expect(held.outcome).toEqual({
      ok: false,
      step: "credential",
      reason: "Another browser is continuing HQ's setup. Open Mate again to follow its progress.",
      uncertain: false,
    });
    expect(zerops.writes).toEqual([]);

    const later = await birth(record, zerops, {
      again: true,
      deps: zerops.deps({ at: HQ_BIRTH_CLAIM_MS }, "b2"),
    });
    expect(later.outcome).toMatchObject({ ok: true });
    expect(zerops.writes).toEqual(ALL_WRITES.slice(1));
  });

  it("a write another browser's intent took first is never sent by this one", async () => {
    const zerops = fakeZerops();
    const record = seeded(zerops, {
      ...HQ_BIRTH_START,
      step: "credential",
      importId: "b1",
      serviceId: "svc-hq",
    });
    zerops
      .journal()
      .set("MATE_HQ_BIRTH_ACTION_org_token_0", JSON.stringify({ state: "started", handles: {} }));
    const { outcome } = await birth(record, zerops);
    expect(outcome).toMatchObject({ ok: false, step: "credential", uncertain: true });
    expect(zerops.writes).toEqual([]);
  });
});
