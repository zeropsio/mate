import { assignCandidateMateTints } from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { EnvironmentId } from "@t3tools/contracts";
import { MATE_SHAPE_OF_TINT, type MateShapeId, type MateTintId } from "@t3tools/shared/brand";
import { describe, expect, it } from "vite-plus/test";

import {
  knownMate,
  mateOpeningAwake,
  mateQuestion,
  mateStageAwake,
  withEnvironmentsOutsideZerops,
  zeropsMateAt,
  zeropsMateDecisions,
  zeropsMateIdentities,
  type ZeropsMateDirectory,
  type ZeropsMateIdentity,
} from "./mateIdentities";

const FEN = EnvironmentId.make("env-fen");
const JUNO = EnvironmentId.make("env-juno");
const STAGE = EnvironmentId.make("env-stage");

function candidate(
  id: string,
  tagList: ReadonlyArray<string>,
  environmentId?: EnvironmentId,
): ZeropsCandidate {
  return {
    key: `${id}:zcp`,
    project: { id, name: id, status: "ACTIVE", tagList },
    group: environmentId === undefined ? "ready" : "connected",
    service: { id: "zcp", name: "zcp", status: "ACTIVE" },
    ...(environmentId === undefined ? {} : { environmentId }),
  };
}

const FEN_TAGS = ["mate", "mate:g:aaa", "mate:role:dev", "mate:name:Acme Docs", "mate:bot:Fen"];
const FEN_DEV = candidate("acme-docs-dev", FEN_TAGS, FEN);
const JUNO_LOOSE = candidate("scratch", ["mate", "mate:bot:Juno"], JUNO);
const ACME_STAGE = candidate("acme-docs-stage", ["mate:g:aaa", "mate:role:stage"], STAGE);

describe("zeropsMateIdentities", () => {
  it("names the Mate in each connected environment, with its colour and its project", () => {
    const mates = zeropsMateIdentities([FEN_DEV, JUNO_LOOSE, ACME_STAGE]);
    expect(mates.get(FEN)).toMatchObject({ name: "Fen", project: "Acme Docs" });
    // The way into Zerops for this Mate: its project on the dashboard.
    expect(mates.get(FEN)?.projectUrl).toBe("https://app.zerops.io/project/acme-docs-dev");
    expect(mates.get(JUNO)).toMatchObject({ name: "Juno", project: undefined });
    // Two Mates, two colours — the same assignment the left menu makes.
    expect(mates.get(FEN)?.tint).not.toBe(mates.get(JUNO)?.tint);
  });

  it.each([
    { name: "names who asked for it", tags: [...FEN_TAGS, "mate:standup:u-ada"], by: "u-ada" },
    { name: "is absent once it was sent", tags: FEN_TAGS, by: undefined },
  ])("carries the project's stand-up ask: $name", ({ tags, by }) => {
    const mate = zeropsMateIdentities([candidate("acme-docs-dev", tags, FEN)]).get(FEN);
    expect(mate?.standUp).toEqual(by === undefined ? undefined : { by });
  });

  it.each([
    { name: "names who made it", tags: [...FEN_TAGS, "mate:by:u-ada"], by: "u-ada" },
    { name: "is absent on a Mate born before it", tags: FEN_TAGS, by: undefined },
  ])("carries who made it: $name", ({ tags, by }) => {
    const mate = zeropsMateIdentities([candidate("acme-docs-dev", tags, FEN)]).get(FEN);
    expect(mate?.madeBy).toBe(by);
  });

  /**
   * A Mate wears the face its person picked (`mate:face:`); one nobody picked
   * a face for wears exactly the one it wore before: its derived tint, and
   * that tint's own shape.
   */
  it.each<{
    readonly case: string;
    readonly tags: ReadonlyArray<string>;
    readonly face: { readonly tint: MateTintId; readonly shape: MateShapeId } | "as before";
  }>([
    {
      case: "the face its person picked",
      tags: ["mate:face:sky:seal"],
      face: { tint: "sky", shape: "seal" },
    },
    { case: "the face it wore before, when nobody picked one", tags: [], face: "as before" },
    {
      case: "its tint's own shape beside a picked tint",
      tags: ["mate:face:rose:blob"],
      face: { tint: "rose", shape: MATE_SHAPE_OF_TINT.rose },
    },
    {
      case: "a picked shape beside the tint it wore before",
      tags: ["mate:face:teal:clover"],
      face: { tint: assignCandidateMateTints([FEN_DEV]).get("acme-docs-dev")!, shape: "clover" },
    },
  ])("gives a Mate $case", ({ tags, face }) => {
    const fen = zeropsMateIdentities([candidate("acme-docs-dev", [...FEN_TAGS, ...tags], FEN)]).get(
      FEN,
    );
    const before = assignCandidateMateTints([FEN_DEV]).get("acme-docs-dev")!;
    expect({ tint: fen?.tint, shape: fen?.shape }).toEqual(
      face === "as before" ? { tint: before, shape: MATE_SHAPE_OF_TINT[before] } : face,
    );
  });

  it("keeps each environment's service identity when a project has two containers", () => {
    const second = {
      ...FEN_DEV,
      key: "acme-docs-dev:probe",
      environmentId: JUNO,
      service: { id: "probe", name: "probe", status: "ACTIVE" },
    };
    const mates = zeropsMateIdentities([FEN_DEV, second]);
    expect(mates.get(FEN)?.serviceId).toBe("zcp");
    expect(mates.get(JUNO)?.serviceId).toBe("probe");
  });

  it("knows nobody in an environment without a Mate, or in no registered environment", () => {
    const mates = zeropsMateIdentities([ACME_STAGE, candidate("dev", ["mate"])]);
    expect(mates.size).toBe(0);
  });

  it("knows a Mate from its container's origin before its socket is up", () => {
    // The environment is registered (its origin is known) but not connected
    // yet: the header and the composer must not wait seconds to learn this is
    // Fen's conversation.
    const ready: ZeropsCandidate = {
      ...candidate("acme-docs-dev", FEN_TAGS),
      containerOrigin: "https://node-id-1.runtime.zcp.zerops.app",
    };
    const mates = zeropsMateIdentities(
      [ready],
      new Map([["https://node-id-1.runtime.zcp.zerops.app", FEN]]),
    );
    expect(mates.get(FEN)).toMatchObject({ name: "Fen", project: "Acme Docs" });
    // The way into Zerops for this Mate: its project on the dashboard.
    expect(mates.get(FEN)?.projectUrl).toBe("https://app.zerops.io/project/acme-docs-dev");
  });
});

describe("zeropsMateDecisions", () => {
  const known = (row: ZeropsCandidate) => ({ ...row, presence: "known" as const });

  it("decides each environment a read row reaches: its Mate, or nobody", () => {
    const decided = zeropsMateDecisions([known(FEN_DEV), known(ACME_STAGE)]);
    expect(decided.get(FEN)).toMatchObject({ name: "Fen" });
    expect(decided.get(STAGE)).toBeNull();
  });

  it("decides nothing for a row whose presence is not read", () => {
    const decided = zeropsMateDecisions([{ ...ACME_STAGE, presence: "unknown" }]);
    expect(decided.has(STAGE)).toBe(false);
  });
});

describe("zeropsMateAt", () => {
  const FEN_MATE: ZeropsMateIdentity = {
    name: "Fen",
    tint: "coral",
    shape: "pentagon",
    project: undefined,
    projectUrl: "https://app.zerops.io/project/acme-docs-dev",
    connected: false,
  };
  const decided = new Map<EnvironmentId, ZeropsMateIdentity | null>([
    [FEN, FEN_MATE],
    [STAGE, null],
  ]);

  it.each<{
    readonly name: string;
    readonly directory: ZeropsMateDirectory;
    readonly environmentId: EnvironmentId;
    readonly kind: "mate" | "nobody" | "unknown";
  }>([
    { name: "a decided Mate", directory: decided, environmentId: FEN, kind: "mate" },
    { name: "a decided nobody", directory: decided, environmentId: STAGE, kind: "nobody" },
    {
      name: "an environment no read row reaches",
      directory: decided,
      environmentId: JUNO,
      kind: "unknown",
    },
  ])("answers $name as $kind", ({ directory, environmentId, kind }) => {
    expect(zeropsMateAt(directory, environmentId).kind).toBe(kind);
  });
});

describe("knownMate", () => {
  const remembered = {
    name: "Gita",
    tint: "amber",
    shape: MATE_SHAPE_OF_TINT.amber,
    project: "Heron",
    projectUrl: "https://example.test/project",
    connected: false,
  } as const;
  const read = { ...remembered, name: "Gita", connected: true };

  it.each([
    { name: "the directory's Mate, read", at: { kind: "mate", mate: read }, known: read },
    {
      name: "nobody, read: none, whatever was remembered",
      at: { kind: "nobody" },
      known: undefined,
    },
    { name: "not read yet: the one remembered there", at: { kind: "unknown" }, known: remembered },
  ] as const)("$name", ({ at, known }) => {
    expect(knownMate(at, () => remembered)).toEqual(known);
  });

  it("knows none where the directory is not read and nothing is remembered", () => {
    expect(knownMate({ kind: "unknown" }, () => undefined)).toBeUndefined();
  });
});

describe("withEnvironmentsOutsideZerops", () => {
  const LOCAL = EnvironmentId.make("env-local");
  const FEN_MATE: ZeropsMateIdentity = {
    name: "Fen",
    tint: "coral",
    shape: "pentagon",
    project: undefined,
    projectUrl: "https://app.zerops.io/project/acme-docs-dev",
    connected: false,
  };
  const NOTHING: ZeropsMateDirectory = new Map();
  const environments = [
    { environmentId: LOCAL, zeropsProjectId: null },
    { environmentId: JUNO, zeropsProjectId: "acme-docs-dev" },
    { environmentId: FEN, zeropsProjectId: null },
    { environmentId: STAGE, zeropsProjectId: undefined },
  ];

  it.each<{
    readonly name: string;
    readonly directory: ZeropsMateDirectory;
    readonly environmentId: EnvironmentId;
    readonly kind: "mate" | "nobody" | "unknown";
  }>([
    {
      name: "an environment whose server runs outside Zerops, no list read",
      directory: NOTHING,
      environmentId: LOCAL,
      kind: "nobody",
    },
    {
      name: "a Zerops environment no read row reaches",
      directory: NOTHING,
      environmentId: JUNO,
      kind: "unknown",
    },
    {
      name: "an environment whose server has not said where it runs",
      directory: NOTHING,
      environmentId: STAGE,
      kind: "unknown",
    },
    {
      name: "a Mate the list decided",
      directory: new Map([[FEN, FEN_MATE]]),
      environmentId: FEN,
      kind: "mate",
    },
  ])("answers $name as $kind", ({ directory, environmentId, kind }) => {
    expect(
      zeropsMateAt(withEnvironmentsOutsideZerops(directory, environments), environmentId).kind,
    ).toBe(kind);
  });

  it("hands back the same directory when it decides nothing new", () => {
    expect(withEnvironmentsOutsideZerops(NOTHING, [environments[1]!])).toBe(NOTHING);
  });
});

describe("mateQuestion", () => {
  it("asks what the Mate should do on its project", () => {
    expect(mateQuestion({ name: "Fen", project: "Acme Docs" })).toBe(
      "What should Fen do on Acme Docs?",
    );
  });

  it("asks without a project for a Mate in none", () => {
    expect(mateQuestion({ name: "Nova", project: undefined })).toBe("What should Nova do?");
  });
});

// A Mate's opening wears the face its container's state gives it (the owner, 2026-10-03: the face
// stood asleep on every open and woke as the conversation came, though nothing had slept).
describe("whether a Mate's opening wears it awake", () => {
  it.each<{
    readonly case: string;
    readonly mate: Pick<ZeropsMateIdentity, "connected" | "running">;
    readonly awake: boolean;
  }>([
    { case: "its container connected", mate: { connected: true, running: true }, awake: true },
    {
      case: "its container running, its socket not up yet",
      mate: { connected: false, running: true },
      awake: true,
    },
    { case: "its container not running", mate: { connected: false, running: false }, awake: false },
    { case: "nothing known of its container", mate: { connected: false }, awake: false },
  ])("$case", ({ mate, awake }) => {
    expect(mateOpeningAwake(mate)).toBe(awake);
  });

  it.each<{
    readonly case: string;
    readonly group: ZeropsCandidate["group"];
    readonly running: boolean;
  }>([
    { case: "connected", group: "connected", running: true },
    { case: "ready, its socket not up", group: "ready", running: true },
    { case: "stopped", group: "unavailable", running: false },
  ])("carries its project, and its container running when $case", ({ group, running }) => {
    const mate = zeropsMateIdentities([{ ...FEN_DEV, group }]).get(FEN);
    expect(mate).toMatchObject({ projectId: "acme-docs-dev", running });
  });
});

// A Mate's own page wears it as its opening does: awake while its container runs and the page
// only waits; asleep where the page speaks of its link, and as its arrival says while it arrives.
describe("whether a Mate's own page wears it awake", () => {
  const RUNNING = { connected: false, running: true } as const;
  const STOPPED = { connected: false, running: false } as const;
  it.each<{
    readonly case: string;
    readonly input: Parameters<typeof mateStageAwake>[0];
    readonly awake: boolean;
  }>([
    {
      case: "linked",
      input: { linked: true, arriving: false, speaks: false, mate: STOPPED },
      awake: true,
    },
    {
      case: "its container running, the page only waiting",
      input: { linked: false, arriving: false, speaks: false, mate: RUNNING },
      awake: true,
    },
    {
      case: "its container stopped",
      input: { linked: false, arriving: false, speaks: false, mate: STOPPED },
      awake: false,
    },
    {
      case: "the page speaking of its link",
      input: { linked: false, arriving: false, speaks: true, mate: RUNNING },
      awake: false,
    },
    {
      case: "a new Mate arriving, whose board says its face",
      input: { linked: false, arriving: true, speaks: false, mate: RUNNING },
      awake: false,
    },
  ])("$case", ({ input, awake }) => {
    expect(mateStageAwake(input)).toBe(awake);
  });
});
