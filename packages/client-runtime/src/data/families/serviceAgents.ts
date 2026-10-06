/**
 * The coding agents a Mate's container is signed in with (`agentSelection.ts`): its service's
 * `ZCP_AGENT_OAUTH_*` flags, the one source the platform does not redact, read by a search of
 * those keys alone (`POST /user-data/search`) — never the service's whole set of variables, which
 * carries every secret it holds. Only the derived agents leave the decoder. Sampled while a screen
 * needs it; a new demand within its freshness reads nothing.
 *
 * @module data/families/serviceAgents
 */
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { AGENT_OAUTH_FLAG_KEYS, agentsFromOAuthFlags } from "../../zerops/agentSelection.ts";
import type { ZeropsAgentType } from "../../zerops/newProject.ts";
import type { ScopeKey } from "../model.ts";
import { STREAM_POLICY } from "../streamMachine.ts";
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
    path: () => "/user-data/search",
    search: ({ orgId, ownerId }) => ({
      search: [
        { name: "clientId", operator: "eq", value: orgId },
        { name: "serviceStackId", operator: "eq", value: ownerId },
        { name: "key", operator: "in", value: AGENT_OAUTH_FLAG_KEYS },
      ],
      sort: [],
      limit: AGENT_OAUTH_FLAG_KEYS.length,
    }),
    decode: (answer) =>
      Option.match(decodeAnswer(answer), {
        onNone: () => null,
        onSome: ({ items }) => agentsFromOAuthFlags((items ?? []).filter(isVariable)),
      }),
    freshMs: STREAM_POLICY.sampledIntervalMs,
  },
};

export const agentsScope = (orgId: string, serviceId: string): ScopeKey =>
  scopeOf(serviceAgentsFamily, orgId, serviceId);
