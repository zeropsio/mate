import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { mateQuestion, zeropsMateIdentities } from "./mateIdentities";

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

const FEN_DEV = candidate(
  "acme-docs-dev",
  ["mate", "mate:g:aaa", "mate:role:dev", "mate:name:Acme Docs", "mate:bot:Fen"],
  FEN,
);
const JUNO_LOOSE = candidate("scratch", ["mate", "mate:bot:Juno"], JUNO);
const ACME_STAGE = candidate("acme-docs-stage", ["mate:g:aaa", "mate:role:stage"], STAGE);

describe("zeropsMateIdentities", () => {
  it("names the Mate in each connected environment, with its colour and its project", () => {
    const mates = zeropsMateIdentities([FEN_DEV, JUNO_LOOSE, ACME_STAGE]);
    expect(mates.get(FEN)).toMatchObject({ name: "Fen", project: "Acme Docs" });
    expect(mates.get(JUNO)).toMatchObject({ name: "Juno", project: undefined });
    // Two Mates, two colours — the same assignment the left menu makes.
    expect(mates.get(FEN)?.tint).not.toBe(mates.get(JUNO)?.tint);
  });

  it("knows nobody in an environment without a Mate, or without a socket", () => {
    const mates = zeropsMateIdentities([ACME_STAGE, candidate("dev", ["mate"])]);
    expect(mates.size).toBe(0);
  });
});

describe("mateQuestion", () => {
  it("asks what the Mate should do on its project", () => {
    expect(mateQuestion({ name: "Fen", tint: "coral", project: "Acme Docs" })).toBe(
      "What should Fen do on Acme Docs?",
    );
  });

  it("asks without a project for a Mate in none", () => {
    expect(mateQuestion({ name: "Nova", tint: "rose", project: undefined })).toBe(
      "What should Nova do?",
    );
  });
});
