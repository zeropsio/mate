import { assignCandidateMateTints } from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import type { HqPlacement } from "@t3tools/client-runtime/zerops/hq";
import { EnvironmentId } from "@t3tools/contracts";
import { MATE_SHAPE_OF_TINT, type MateShapeId, type MateTintId } from "@t3tools/shared/brand";
import { describe, expect, it } from "vite-plus/test";

import {
  knownMate,
  mateQuestion,
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

/** A project's candidate: Acme Docs' dev project is Fen's, named as Fen is (D3). */
function candidate(
  id: string,
  tagList: ReadonlyArray<string>,
  environmentId?: EnvironmentId,
  hq?: HqPlacement,
): ZeropsCandidate {
  const name = id === "acme-docs-dev" ? "Fen" : id;
  return {
    key: `${id}:zcp`,
    project: { id, name, status: "ACTIVE", tagList, ...(hq === undefined ? {} : { hq }) },
    group: environmentId === undefined ? "ready" : "connected",
    service: { id: "zcp", name: "zcp", status: "ACTIVE" },
    ...(environmentId === undefined ? {} : { environmentId }),
  };
}

/** Where HQ places a project of Acme Docs. */
function acme(kind: HqPlacement["kind"], mate: HqPlacement["mate"] = null): HqPlacement {
  return { appId: "aaa", appName: "Acme Docs", kind, mate };
}

/** Fen, wearing `face` as HQ records it ("" where nobody picked one). */
const fen = (face = "") => acme("mate", { face });
const FEN_DEV = candidate("acme-docs-dev", ["mate"], FEN, fen());
/** A Mate in no project, going by its project's name as every Mate does. */
const LOOSE = candidate("scratch", ["mate"], JUNO);
const ACME_STAGE = candidate("acme-docs-stage", [], STAGE, acme("stage"));

describe("zeropsMateIdentities", () => {
  it("names the Mate in each connected environment, with its colour and its project", () => {
    const mates = zeropsMateIdentities([FEN_DEV, LOOSE, ACME_STAGE]);
    expect(mates.get(FEN)).toMatchObject({ name: "Fen", project: "Acme Docs" });
    // The way into Zerops for this Mate: its project on the dashboard.
    expect(mates.get(FEN)?.projectUrl).toBe("https://app.zerops.io/project/acme-docs-dev");
    expect(mates.get(JUNO)).toMatchObject({ name: "scratch", project: undefined });
    // Two Mates, two colours — the same assignment the left menu makes.
    expect(mates.get(FEN)?.tint).not.toBe(mates.get(JUNO)?.tint);
  });

  it.each([
    { name: "names who asked for it", asker: "u-ada", by: "u-ada" },
    { name: "is absent once it was sent", asker: null, by: undefined },
  ])("carries the stand-up ask HQ records: $name", ({ asker, by }) => {
    const placed = acme("mate", { face: "", standupRequestedBy: asker });
    const mate = zeropsMateIdentities([candidate("acme-docs-dev", ["mate"], FEN, placed)]).get(FEN);
    expect(mate?.standUp).toEqual(by === undefined ? undefined : { by });
  });

  it.each([
    { name: "names who made it", maker: "u-ada", madeBy: "u-ada" },
    { name: "is absent on a Mate recorded before HQ kept it", maker: null, madeBy: undefined },
  ])("carries who made it, as HQ records it: $name", ({ maker, madeBy }) => {
    const placed = acme("mate", { face: "", madeBy: maker });
    const mate = zeropsMateIdentities([candidate("acme-docs-dev", ["mate"], FEN, placed)]).get(FEN);
    expect(mate?.madeBy).toBe(madeBy);
  });

  /**
   * A Mate wears the face its person picked (HQ's record); one nobody picked
   * a face for wears exactly the one it wore before: its derived tint, and
   * that tint's own shape.
   */
  it.each<{
    readonly case: string;
    /** The face as HQ records it. */
    readonly picked: string;
    readonly face: { readonly tint: MateTintId; readonly shape: MateShapeId } | "as before";
  }>([
    {
      case: "the face its person picked",
      picked: "sky:seal",
      face: { tint: "sky", shape: "seal" },
    },
    { case: "the face it wore before, when nobody picked one", picked: "", face: "as before" },
    {
      case: "its tint's own shape beside a picked tint",
      picked: "rose:blob",
      face: { tint: "rose", shape: MATE_SHAPE_OF_TINT.rose },
    },
    {
      case: "a picked shape beside the tint it wore before",
      picked: "teal:clover",
      face: { tint: assignCandidateMateTints([FEN_DEV]).get("acme-docs-dev")!, shape: "clover" },
    },
  ])("gives a Mate $case", ({ picked, face }) => {
    const mate = zeropsMateIdentities([candidate("acme-docs-dev", ["mate"], FEN, fen(picked))]).get(
      FEN,
    );
    const before = assignCandidateMateTints([FEN_DEV]).get("acme-docs-dev")!;
    expect({ tint: mate?.tint, shape: mate?.shape }).toEqual(
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
      ...candidate("acme-docs-dev", ["mate"], undefined, fen()),
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
