/**
 * HQ's birth's writes at Zerops (`operations/hqBirth.ts`). Each that can ask Zerops where it stands
 * asks first and writes only what is missing: a variable HQ's service holds is left alone, a token
 * or a routing of its name is taken up rather than made twice. A credential's value goes from
 * Zerops's answer straight into HQ's sensitive variable, never into a result.
 *
 * @module data/operations/executors/hqBirth
 */
import * as Effect from "effect/Effect";

import { ZeropsApiError, type ZeropsApiClient } from "../../../zerops/api.ts";
import { findOfficialHq, hqAnchorName, hqOrgTokenName } from "../../../zerops/hq/anchor.ts";
import {
  HQ_KEY_SECRET_BYTES,
  HQ_KEY_SECRET_ENV,
  HQ_ORG_TOKEN_ENV,
  HQ_PORT,
} from "../../../zerops/hq/birth.ts";
import type { RandomBytes } from "../../../zerops/newProject.ts";
import type { OperationIntent, OperationReceipt, OperationResult } from "../../model.ts";
import type { OperationExecutor } from "../coordinator.ts";
import { HQ_BIRTH_SLOT_TAKEN } from "../hqBirth.ts";
import type { IntentOf } from "../kind.ts";
import { answeredReceipt } from "./answered.ts";
import { verb } from "./write.ts";

export type HqBirthWritesPlatform = Pick<
  ZeropsApiClient,
  | "createProjectEnv"
  | "hasServiceVariable"
  | "listIntegrationTokens"
  | "mintIntegrationToken"
  | "regenerateIntegrationToken"
  | "writeServiceSecret"
  | "listPublicHttpRoutings"
  | "createPublicHttpRouting"
  | "syncPublicHttpRouting"
  | "listOrganizationMembers"
>;

type BirthWrite = IntentOf<
  "hq-birth-note" | "hq-org-token" | "hq-key-secret" | "route-hq-domain" | "mark-official-hq"
>;

/** A refusal in the words the gate shows, with the way on where Zerops's code names one. */
function inBirthWords(cause: unknown): unknown {
  if (!(cause instanceof ZeropsApiError)) return cause;
  if (cause.code === "userDataSyncRunning")
    return new ZeropsApiError(
      "Variables still syncing. Press Again to continue HQ's setup.",
      "invalid-input",
      cause.status,
    );
  if (cause.kind === "invalid-input" && /not unique/iu.test(cause.message))
    return new ZeropsApiError(HQ_BIRTH_SLOT_TAKEN, "invalid-input", cause.status);
  if (cause.kind === "forbidden")
    return new ZeropsApiError(
      `${cause.detail ?? cause.message}. Ask an organization owner to restore your access in Zerops, then press Again.`,
      "forbidden",
      cause.status,
    );
  return cause;
}

const birthVerb = <A>(call: () => Promise<A>) =>
  verb(() =>
    call().catch((cause: unknown) => {
      throw inBirthWords(cause);
    }),
  );

const refused = (message: string) =>
  Effect.fail({ outcome: "definitive-refusal", message } as const);

/** Done as Zerops answered, with what it answered where the kind declares a result. */
const done = (
  requestId: string,
  target: { readonly family: "project" | "service"; readonly id: string },
  result?: OperationResult,
): OperationReceipt => ({
  ...answeredReceipt(requestId, target),
  acceptance: { kind: "accepted", ...(result === undefined ? {} : { result }) },
});

/** Accepted, its process ending it. */
const following = (
  requestId: string,
  processId: string,
  result?: OperationResult,
): OperationReceipt => ({
  requestId,
  operationId: processId,
  executor: "zerops",
  affected: [{ family: "process", id: processId }],
  handles: [processId],
  acceptance: { kind: "accepted", ...(result === undefined ? {} : { result }) },
  outcome: { kind: "pending" },
});

export function hqBirthExecutor(
  platform: HqBirthWritesPlatform,
  /** Draws HQ's key: the platform's cryptographic randomness. */
  randomBytes: RandomBytes = (bytes) => globalThis.crypto.getRandomValues(bytes),
): OperationExecutor["submit"] {
  const holds = (orgId: string, serviceId: string, key: string) =>
    birthVerb(() => platform.hasServiceVariable({ clientId: orgId, serviceId, key }));
  const writeSecret = (serviceId: string, key: string, content: string) =>
    birthVerb(() => platform.writeServiceSecret({ serviceId, key, content }));

  const note = (requestId: string, intent: IntentOf<"hq-birth-note">) =>
    Effect.flatMap(
      birthVerb(() => platform.createProjectEnv(intent.projectId, intent.key, intent.content)),
      ({ processId }) =>
        processId
          ? Effect.succeed(following(requestId, processId))
          : Effect.fail({
              outcome: "uncertain-acceptance",
              message:
                "Zerops accepted HQ's setup record but returned no process to follow. Press Again to read its recorded progress.",
            } as const),
    );

  const orgToken = (requestId: string, intent: IntentOf<"hq-org-token">) =>
    Effect.gen(function* () {
      const target = { family: "service", id: intent.serviceId } as const;
      if (yield* holds(intent.orgId, intent.serviceId, HQ_ORG_TOKEN_ENV))
        return done(requestId, target, { tokenId: null });
      const name = hqOrgTokenName(intent.projectId);
      const named = (yield* birthVerb(() => platform.listIntegrationTokens(intent.orgId))).filter(
        (token) => token.name === name,
      );
      if (named.length > 1)
        return yield* refused(`More than one token is named ${name}. Delete them in Zerops.`);
      // A token's value is one-time: one made before whose value never reached HQ is regenerated,
      // never minted again.
      const held = named[0];
      const token =
        held === undefined
          ? yield* birthVerb(() =>
              platform.mintIntegrationToken({
                clientId: intent.orgId,
                name,
                roleCode: "READ_ONLY",
                projects: [],
              }),
            )
          : {
              id: held.id,
              token: yield* birthVerb(() =>
                platform.regenerateIntegrationToken({ clientId: intent.orgId, tokenId: held.id }),
              ),
            };
      yield* writeSecret(intent.serviceId, HQ_ORG_TOKEN_ENV, token.token);
      return done(requestId, target, { tokenId: token.id });
    });

  const keySecret = (requestId: string, intent: IntentOf<"hq-key-secret">) =>
    Effect.gen(function* () {
      const target = { family: "service", id: intent.serviceId } as const;
      if (!(yield* holds(intent.orgId, intent.serviceId, HQ_KEY_SECRET_ENV))) {
        const key = randomBytes(new Uint8Array(HQ_KEY_SECRET_BYTES));
        yield* writeSecret(intent.serviceId, HQ_KEY_SECRET_ENV, btoa(String.fromCharCode(...key)));
      }
      return done(requestId, target);
    });

  const route = (requestId: string, intent: IntentOf<"route-hq-domain">) =>
    Effect.gen(function* () {
      const routed = () =>
        Effect.map(
          birthVerb(() => platform.listPublicHttpRoutings(intent.projectId)),
          (routings) =>
            routings.find((routing) =>
              routing.domains.some((entry) => entry.domainName === intent.domain),
            ),
        );
      let routing = yield* routed();
      if (routing === undefined) {
        yield* birthVerb(() =>
          platform.createPublicHttpRouting(intent.projectId, {
            domains: [intent.domain],
            locations: [{ path: "/", port: HQ_PORT, serviceStackId: intent.serviceId }],
          }),
        );
        routing = yield* routed();
      }
      const target = { family: "project", id: intent.projectId } as const;
      if (routing?.isSynced === true) return done(requestId, target, { processId: null });
      const { processId } = yield* birthVerb(() =>
        platform.syncPublicHttpRouting(intent.projectId),
      );
      return processId === undefined
        ? done(requestId, target, { processId: null })
        : following(requestId, processId, { processId });
    });

  const mark = (requestId: string, intent: IntentOf<"mark-official-hq">) =>
    Effect.gen(function* () {
      const found = findOfficialHq(
        yield* birthVerb(() => platform.listOrganizationMembers(intent.orgId)),
      );
      const named =
        found.kind === "official"
          ? [found.projectId]
          : found.kind === "unclear"
            ? found.projectIds
            : [];
      // Two HQs are none.
      if (named.some((projectId) => projectId !== intent.projectId))
        return yield* refused("This organization has an HQ already.");
      const name = hqAnchorName(intent.projectId, intent.address);
      const target = { family: "project", id: intent.projectId } as const;
      const held = (yield* birthVerb(() => platform.listIntegrationTokens(intent.orgId))).find(
        (token) => token.name === name,
      );
      if (held !== undefined) return done(requestId, target, { tokenId: held.id });
      // A mark in the member list, never a credential: its value goes nowhere.
      const minted = yield* birthVerb(() =>
        platform.mintIntegrationToken({
          clientId: intent.orgId,
          name,
          roleCode: "ADMIN",
          projects: [],
        }),
      );
      return done(requestId, target, { tokenId: minted.id });
    });

  return (requestId: string, intent: OperationIntent) => {
    const write = intent as BirthWrite;
    switch (write.kind) {
      case "hq-birth-note":
        return note(requestId, write);
      case "hq-org-token":
        return orgToken(requestId, write);
      case "hq-key-secret":
        return keySecret(requestId, write);
      case "route-hq-domain":
        return route(requestId, write);
      case "mark-official-hq":
        return mark(requestId, write);
    }
  };
}
