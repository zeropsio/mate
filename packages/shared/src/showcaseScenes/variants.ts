import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as SchemaAST from "effect/SchemaAST";

import { ZeropsActivityResult } from "./activityResult.ts";
import { ShowcaseSceneJson, type ShowcaseScene } from "./schema.ts";

const UNKNOWN_FIELD = "newerShape";
const UNKNOWN_SERVICE_STATUS = "FUTURE_STATUS";
const UNKNOWN_PHASE = "future-phase";
const UNKNOWN_IDLE_SCENARIO = "future-idle";
const UNKNOWN_AGENT_ID = "future-agent";
const UNKNOWN_AGENT_AUTH_STATE = "future-auth-state";
const UNKNOWN_AGENT_LOGIN_PHASE = "future-login-phase";
const UNKNOWN_TOOL_STATUS = "future-tool-status";

const encodeScene = Schema.encodeSync(ShowcaseSceneJson);
const encodedSceneAst = SchemaAST.toEncoded(ShowcaseSceneJson.ast);
const encodedActivityResultAst = SchemaAST.toEncoded(ZeropsActivityResult.ast);

type VariantMode = "omit-optionals" | "unknown-shape";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Predicate.isObject(value) && !Array.isArray(value);

function matchesValue(ast: SchemaAST.AST, value: unknown): boolean {
  switch (ast._tag) {
    case "Arrays":
      return Array.isArray(value);
    case "BigInt":
      return typeof value === "bigint";
    case "Boolean":
      return typeof value === "boolean";
    case "Literal":
      return Object.is(value, ast.literal);
    case "Null":
      return value === null;
    case "Number":
      return typeof value === "number";
    case "Objects":
      return isRecord(value);
    case "String":
    case "TemplateLiteral":
      return typeof value === "string";
    case "Suspend":
      return matchesValue(ast.thunk(), value);
    case "Undefined":
      return value === undefined;
    case "Union":
      return ast.types.some((member) => matchesValue(member, value));
    default:
      return true;
  }
}

function arrayElementAst(ast: SchemaAST.Arrays, index: number, length: number) {
  if (index < ast.elements.length) {
    return ast.elements[index];
  }
  if (ast.rest.length === 0) {
    return undefined;
  }
  const trailingCount = ast.rest.length - 1;
  const trailingStart = length - trailingCount;
  return index >= trailingStart ? ast.rest[index - trailingStart + 1] : ast.rest[0];
}

function transformValue(ast: SchemaAST.AST, value: unknown, mode: VariantMode): unknown {
  switch (ast._tag) {
    case "Suspend":
      return transformValue(ast.thunk(), value, mode);
    case "Union": {
      const member = ast.types.find((candidate) => matchesValue(candidate, value));
      return member === undefined ? structuredClone(value) : transformValue(member, value, mode);
    }
    case "Arrays":
      return Array.isArray(value)
        ? value.map((entry, index) => {
            const elementAst = arrayElementAst(ast, index, value.length);
            return elementAst === undefined
              ? structuredClone(entry)
              : transformValue(elementAst, entry, mode);
          })
        : structuredClone(value);
    case "Objects": {
      if (!isRecord(value)) {
        return structuredClone(value);
      }
      if (ast.propertySignatures.length === 0 && ast.indexSignatures.length === 0) {
        return structuredClone(value);
      }

      const output: Record<string, unknown> = {};
      const declaredKeys = new Set<string>();
      // `ModelSelectionSource` requires one routing key in its transform even though the AST
      // marks both `provider` and `instanceId` optional. Omit `provider`, but retain `instanceId`.
      const hasOptionalProviderSibling = ast.propertySignatures.some(
        (property) => property.name === "provider" && SchemaAST.isOptional(property.type),
      );
      for (const property of ast.propertySignatures) {
        if (typeof property.name !== "string") {
          continue;
        }
        declaredKeys.add(property.name);
        if (!Object.hasOwn(value, property.name)) {
          continue;
        }
        if (
          mode === "omit-optionals" &&
          SchemaAST.isOptional(property.type) &&
          !(property.name === "instanceId" && hasOptionalProviderSibling)
        ) {
          continue;
        }
        output[property.name] = transformValue(property.type, value[property.name], mode);
      }

      for (const [key, entry] of Object.entries(value)) {
        if (declaredKeys.has(key)) {
          continue;
        }
        const indexSignature = ast.indexSignatures[0];
        if (indexSignature === undefined) {
          continue;
        }
        if (mode === "omit-optionals" && SchemaAST.isOptional(indexSignature.type)) {
          continue;
        }
        output[key] = transformValue(indexSignature.type, entry, mode);
      }

      if (
        mode === "unknown-shape" &&
        ast.propertySignatures.length > 0 &&
        ast.indexSignatures.length === 0
      ) {
        output[UNKNOWN_FIELD] = true;
      }
      return output;
    }
    default:
      return structuredClone(value);
  }
}

function mapActivityResults(scene: unknown, mode: VariantMode): void {
  if (!isRecord(scene) || !isRecord(scene.threadActivities)) {
    return;
  }
  for (const activities of Object.values(scene.threadActivities)) {
    if (!Array.isArray(activities)) {
      continue;
    }
    for (const activity of activities) {
      if (!isRecord(activity) || !isRecord(activity.payload) || !isRecord(activity.payload.data)) {
        continue;
      }
      const data = activity.payload.data;
      if (Object.hasOwn(data, "zerops")) {
        data.zerops = transformValue(encodedActivityResultAst, data.zerops, mode);
      }
    }
  }
}

function futureTopologyService() {
  return {
    id: "future-service",
    name: "futuredev",
    status: UNKNOWN_SERVICE_STATUS,
  };
}

function futureEnvelopeService() {
  return {
    hostname: "futuredev",
    typeVersion: "nodejs@future",
    runtimeClass: "dynamic",
    status: UNKNOWN_SERVICE_STATUS,
    bootstrapped: true,
  };
}

function futureEnvelope() {
  return {
    phase: UNKNOWN_PHASE,
    environment: "container",
    idleScenario: UNKNOWN_IDLE_SCENARIO,
    project: { id: "future-project", name: "Future project" },
    services: [futureEnvelopeService()],
    generated: "2026-08-30T12:00:00.000Z",
  };
}

function ensureEnvelope(scene: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!isRecord(scene.lifecycle)) {
    return undefined;
  }
  if (!isRecord(scene.lifecycle.envelope)) {
    scene.lifecycle.envelope = futureEnvelope();
  }
  return isRecord(scene.lifecycle.envelope) ? scene.lifecycle.envelope : undefined;
}

function futureAgent() {
  return {
    agentId: "codex",
    credPresent: false,
    flagOAuth: false,
    flagToken: false,
    providerAuth: "unknown",
    state: "not-authorized",
  };
}

function ensureAgent(scene: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!isRecord(scene.agentAuth)) {
    return undefined;
  }
  const agents = Array.isArray(scene.agentAuth.agents)
    ? scene.agentAuth.agents
    : (scene.agentAuth.agents = []);
  const agent = agents.find(isRecord);
  if (agent !== undefined) {
    return agent;
  }
  const created = futureAgent();
  agents.push(created);
  return created;
}

function addUnknownOpenValues(scene: unknown): void {
  if (!isRecord(scene) || !isRecord(scene.topologySource) || !isRecord(scene.lifecycle)) {
    return;
  }

  const topologyServices = Array.isArray(scene.topologySource.services)
    ? scene.topologySource.services
    : (scene.topologySource.services = []);
  if (topologyServices.length === 0) {
    topologyServices.push(futureTopologyService());
  }
  for (const service of topologyServices) {
    if (isRecord(service)) {
      service.status = UNKNOWN_SERVICE_STATUS;
    }
  }

  const envelope = ensureEnvelope(scene);
  if (envelope === undefined) {
    return;
  }
  envelope.phase = UNKNOWN_PHASE;
  envelope.idleScenario = UNKNOWN_IDLE_SCENARIO;
  const envelopeServices = Array.isArray(envelope.services)
    ? envelope.services
    : (envelope.services = []);
  if (envelopeServices.length === 0) {
    envelopeServices.push(futureEnvelopeService());
  }
  for (const service of envelopeServices) {
    if (isRecord(service)) {
      service.status = UNKNOWN_SERVICE_STATUS;
    }
  }
}

/** JSON-ready scene with every schema-optional field removed. */
export function withoutOptionals(scene: ShowcaseScene): unknown {
  const encoded = transformValue(encodedSceneAst, encodeScene(scene), "omit-optionals");
  mapActivityResults(encoded, "omit-optionals");
  return encoded;
}

/** JSON-ready scene carrying excess struct fields and future values for every open vocabulary. */
export function withUnknownShape(scene: ShowcaseScene): unknown {
  const encoded = encodeScene(scene);
  addUnknownOpenValues(encoded);
  const variant = transformValue(encodedSceneAst, encoded, "unknown-shape");
  mapActivityResults(variant, "unknown-shape");
  return variant;
}

/** JSON-ready scene that must fail decoding because agent auth state is a closed vocabulary. */
export function withUnknownClosedAgentAuthState(scene: ShowcaseScene): unknown {
  const encoded = encodeScene(scene);
  if (!isRecord(encoded)) {
    return encoded;
  }
  const agent = ensureAgent(encoded);
  if (agent !== undefined) {
    agent.state = UNKNOWN_AGENT_AUTH_STATE;
  }
  return encoded;
}

/** JSON-ready scene that must fail decoding because agent id is a closed vocabulary. */
export function withUnknownClosedAgentId(scene: ShowcaseScene): unknown {
  const encoded = encodeScene(scene);
  if (isRecord(encoded)) {
    const agent = ensureAgent(encoded);
    if (agent !== undefined) {
      agent.agentId = UNKNOWN_AGENT_ID;
    }
  }
  return encoded;
}

/** JSON-ready scene that must fail decoding because agent login phase is a closed vocabulary. */
export function withUnknownClosedAgentLoginPhase(scene: ShowcaseScene): unknown {
  const encoded = encodeScene(scene);
  if (isRecord(encoded)) {
    const agent = ensureAgent(encoded);
    if (agent !== undefined) {
      agent.login = {
        phase: UNKNOWN_AGENT_LOGIN_PHASE,
        terminalId: "future-terminal",
        startedAt: "2026-08-30T12:00:00.000Z",
      };
    }
  }
  return encoded;
}

/** JSON-ready scene that must fail decoding because recent-tool status is a closed vocabulary. */
export function withUnknownClosedToolStatus(scene: ShowcaseScene): unknown {
  const encoded = encodeScene(scene);
  if (!isRecord(encoded) || !isRecord(encoded.lifecycle)) {
    return encoded;
  }
  const lifecycle: Record<string, unknown> = encoded.lifecycle;
  const recentTools = Array.isArray(lifecycle.recentTools)
    ? lifecycle.recentTools
    : (lifecycle.recentTools = []);
  const tool = recentTools.find(isRecord);
  if (tool !== undefined) {
    tool.status = UNKNOWN_TOOL_STATUS;
  } else {
    recentTools.push({
      toolName: "zerops_future",
      status: UNKNOWN_TOOL_STATUS,
      at: "2026-08-30T12:00:00.000Z",
    });
  }
  return encoded;
}

/** JSON-ready scene with one undecodable envelope service among decodable siblings. */
export function withUndecodableArrayElement(scene: ShowcaseScene): unknown {
  const encoded = encodeScene(scene);
  if (!isRecord(encoded)) {
    return encoded;
  }
  const envelope = ensureEnvelope(encoded);
  if (envelope === undefined) {
    return encoded;
  }
  const services = Array.isArray(envelope.services)
    ? envelope.services
    : (envelope.services = [futureEnvelopeService()]);
  if (!services.some(isRecord)) {
    services.push(futureEnvelopeService());
  }
  services.push({ hostname: 42 });
  return encoded;
}
