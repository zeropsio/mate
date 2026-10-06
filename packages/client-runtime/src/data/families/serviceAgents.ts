/**
 * The coding agents a Mate's container is signed in with (`agentSelection.ts`), read from its
 * service's variables (`GET /service-stack/{id}/env`), the one source the platform does not
 * redact. The variables carry every secret the service holds: only the derived agents leave the
 * decoder, never a key or a value. Sampled while a screen needs it, read again on every new demand.
 *
 * @module data/families/serviceAgents
 */
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { agentsFromOAuthFlags } from "../../zerops/agentSelection.ts";
import type { ZeropsAgentType } from "../../zerops/newProject.ts";
import type { ScopeKey } from "../model.ts";
import { scopeOf, type FamilySpec } from "./spec.ts";

export type ServiceAgentsValue = ReadonlyArray<ZeropsAgentType>;

declare module "../model.ts" {
  interface FamilyValues {
    readonly serviceAgents: ServiceAgentsValue;
  }
}

const Variable = Schema.Struct({ key: Schema.String, content: Schema.String });
const Answer = Schema.Struct({ items: Schema.optionalKey(Schema.Array(Schema.Unknown)) });
const decodeAnswer = Schema.decodeUnknownOption(Answer);
const isVariable = Schema.is(Variable);

export const serviceAgentsFamily: FamilySpec<"serviceAgents"> = {
  family: "serviceAgents",
  authority: "zerops",
  scope: { source: "zerops", suffix: "agents", leaving: "removed", demand: "detail" },
  sampled: {
    path: ({ ownerId }) => `/service-stack/${encodeURIComponent(ownerId)}/env`,
    decode: (answer) =>
      Option.match(decodeAnswer(answer), {
        onNone: () => null,
        onSome: ({ items }) => agentsFromOAuthFlags((items ?? []).filter(isVariable)),
      }),
    freshMs: 0,
  },
};

export const agentsScope = (orgId: string, serviceId: string): ScopeKey =>
  scopeOf(serviceAgentsFamily, orgId, serviceId);
