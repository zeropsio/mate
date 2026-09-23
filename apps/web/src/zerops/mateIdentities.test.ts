import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
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

describe("withEnvironmentsOutsideZerops", () => {
  const LOCAL = EnvironmentId.make("env-local");
  const FEN_MATE: ZeropsMateIdentity = {
    name: "Fen",
    tint: "coral",
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
    expect(
      mateQuestion({
        name: "Fen",
        tint: "coral",
        project: "Acme Docs",
        projectUrl: "https://app.zerops.io/project/acme-docs-dev",
        connected: true,
      }),
    ).toBe("What should Fen do on Acme Docs?");
  });

  it("asks without a project for a Mate in none", () => {
    expect(
      mateQuestion({
        name: "Nova",
        tint: "rose",
        project: undefined,
        projectUrl: "https://app.zerops.io/project/scratch",
        connected: true,
      }),
    ).toBe("What should Nova do?");
  });
});
