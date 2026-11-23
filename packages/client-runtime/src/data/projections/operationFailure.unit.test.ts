import { expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import type { HqOperationFailure } from "@t3tools/shared/hqOperationFailure";
import { HqBirthOperation } from "../../zerops/hq/client.ts";
import {
  accessLostLine,
  operationFailureDetails,
  operationFailureWords,
  platformErrorLine,
} from "./operationFailure.ts";

const at = "2026-11-09T11:04:31.000Z";
const failure = (origin: string, code: string, words?: string | null): HqOperationFailure => ({
  step: "create",
  code,
  at,
  origin,
  ...(words === undefined ? {} : { zerops: { words, status: 403, error: null, request: null } }),
});

// witness: packages/client-runtime/src/data/projections/operationFailure.ts | if (failure.origin === "zerops") → if (failure.origin !== "")
it("PJ128: A stopped operation reads by who stopped it: Zerops' refusal as Zerops' own words or its code, a failed Zerops process and HQ's own stop each as their own sentence, and a code or origin this build does not know as the code; breaks: HQ's stop or a failed build is blamed on a refusal by Zerops, or Zerops' reason hides behind a code", () => {
  const byOrigin = [
    failure("zerops", "several_containers", null),
    failure("zerops_process", "several_containers"),
    failure("hq", "several_containers"),
  ].map(operationFailureWords);
  expect(new Set(byOrigin).size).toBe(3);

  const refused = operationFailureWords(failure("zerops", "v1", "the project limit is reached"));
  expect(refused).toContain("the project limit is reached");
  expect(refused).not.toContain("v1");
  expect(operationFailureWords(failure("zerops", "v1", null))).toContain("v1");

  for (const known of [failure("hq", "token_expired"), failure("zerops_process", "build_failed")])
    expect(operationFailureWords(known)).not.toContain(known.code);

  for (const unknown of [
    failure("zerops", "v2", null),
    failure("zerops_process", "v2"),
    failure("hq", "v2"),
    failure("v3", "v2"),
    failure("v3", "token_expired"),
  ])
    expect(operationFailureWords(unknown)).toContain(unknown.code);
});

/** `mate-hq spec/protocol.md` "Operation failures", its example with a neutral path. */
const refusedCreate = {
  step: "create",
  code: "insufficientPermissions",
  at,
  origin: "zerops",
  zerops: {
    words: "Insufficient permissions",
    status: 403,
    error: {
      code: "insufficientPermissions",
      message: "Insufficient permissions",
      meta: [
        { error: "Insufficient permissions", code: "insufficientPermissions", metadata: null },
      ],
    },
    request: { method: "GET", path: "/project/v4" },
  },
};
const decodeBirthOperation = Schema.decodeUnknownSync(HqBirthOperation);
const decodeFailure = (failure: unknown) =>
  decodeBirthOperation({
    kind: "birth",
    phase: "project_requested",
    at,
    acceptedAt: at,
    failure,
  }).failure!;

// witness: packages/client-runtime/src/data/projections/operationFailure.ts | return failure.origin === "zerops" ? JSON → return failure.origin !== "" ? JSON
it("PJ129: Zerops' whole answer is given as text for a Zerops refusal and for nothing else; breaks: support gets a sentence without the answer behind it, or Details open on a stop Zerops never answered", () => {
  const details = operationFailureDetails(decodeFailure(refusedCreate));
  for (const part of ["403", "insufficientPermissions", "Insufficient permissions", "/project/v4"])
    expect(details).toContain(part);

  const { request: _request, ...withoutRequest } = refusedCreate.zerops;
  const otherShape = decodeFailure({
    ...refusedCreate,
    zerops: { ...withoutRequest, error: "Insufficient permissions" },
  });
  expect(operationFailureDetails(otherShape)).toContain("Insufficient permissions");

  for (const notZerops of [
    decodeFailure({ step: "import", code: "build_failed", at, origin: "zerops_process" }),
    decodeFailure({ step: "key", code: "token_expired", at, origin: "hq" }),
  ])
    expect(operationFailureDetails(notZerops)).toBeNull();
});

// witness: packages/client-runtime/src/data/projections/operationFailure.ts | if (failure.origin !== "hq" || failure.code !== ACCESS_LOST) return null; → if (failure.origin !== "hq") return null;
it("PJ+1: A birth waiting on lost access has its own line, which differs for a reader HQ offers Continue and never shows HQ's code, and no other failure takes that line; breaks: a person who lost access is told their sign-in ran out, or another stop reads as lost access", () => {
  const lost = { ...failure("hq", "access_lost"), step: "import" };
  const continues = accessLostLine(lost, true);
  const waits = accessLostLine(lost, false);
  expect(continues).not.toBeNull();
  expect(waits).not.toBeNull();
  expect(continues).not.toBe(waits);
  expect(continues).not.toContain(lost.code);
  expect(operationFailureWords(lost)).not.toContain(lost.code);
  expect(accessLostLine({ ...lost, code: "token_expired" }, true)).toBeNull();
  expect(accessLostLine({ ...lost, origin: "zerops" }, true)).toBeNull();
});

// witness: packages/client-runtime/src/data/projections/operationFailure.ts | if (failure.origin === "zerops" && failure.code === OBSERVATION_REFUSED) → if (failure.origin === "zerops" && failure.code === "")
it("PJ+2: A check of an operation that Zerops refused reads in words, never as HQ's internal code; breaks: a person reads `Zerops refused: operation_observation_refused`", () => {
  const refused = failure("zerops", "operation_observation_refused", null);
  expect(operationFailureWords(refused)).not.toContain(refused.code);
});

// witness: packages/client-runtime/src/data/projections/operationFailure.ts | ${PLATFORM_ERROR_WAY[way]}` → ${PLATFORM_ERROR_WAY.continue}`
it("PJ141: A Zerops platform error reads as Zerops' fault with the person's project fine, names Continue only for a reader HQ offers it, and a build failed on the person's code keeps its own sentence; breaks: the person is told to fix a project Zerops failed, or is told to Continue where no Continue exists", () => {
  const stopped = { ...failure("zerops_process", "zerops_platform_error"), step: "import" };
  const offersContinue = "Continue to try again";
  expect(platformErrorLine(stopped, "continue")).toContain(offersContinue);
  expect(platformErrorLine(stopped, "maker-continues")).not.toContain(offersContinue);
  expect(platformErrorLine(stopped, "ended")).not.toContain(offersContinue);
  expect(operationFailureWords(stopped)).not.toContain(stopped.code);
  expect(operationFailureWords(stopped)).not.toBe(
    operationFailureWords({ ...stopped, code: "build_failed" }),
  );
  expect(platformErrorLine({ ...stopped, code: "build_failed" }, "continue")).toBeNull();
});
