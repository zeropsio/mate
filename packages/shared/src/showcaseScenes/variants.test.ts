import { describe, expect, it } from "vite-plus/test";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

import { ZeropsActivityResult } from "./activityResult.ts";
import { listShowcaseScenes } from "./index.ts";
import { ShowcaseSceneJson } from "./schema.ts";
import {
  withoutOptionals,
  withUndecodableArrayElement,
  withUnknownClosedAgentAuthState,
  withUnknownClosedAgentId,
  withUnknownClosedAgentLoginPhase,
  withUnknownClosedToolStatus,
  withUnknownShape,
} from "./variants.ts";

const decodeScene = Schema.decodeUnknownSync(ShowcaseSceneJson);
const decodeActivityResult = Schema.decodeUnknownSync(ZeropsActivityResult);

function asRecord(value: unknown): Record<string, unknown> {
  expect(Predicate.isObject(value) && !Array.isArray(value)).toBe(true);
  return value as Record<string, unknown>;
}

function activityResults(scene: Record<string, unknown>): ReadonlyArray<unknown> {
  if (!Predicate.isObject(scene.threadActivities) || Array.isArray(scene.threadActivities)) {
    return [];
  }
  return Object.values(scene.threadActivities).flatMap((activities) =>
    Array.isArray(activities)
      ? activities.flatMap((activity) => {
          if (!Predicate.isObject(activity) || Array.isArray(activity)) {
            return [];
          }
          const payload = activity.payload;
          if (!Predicate.isObject(payload) || Array.isArray(payload)) {
            return [];
          }
          const data = payload.data;
          return Predicate.isObject(data) && !Array.isArray(data) && Object.hasOwn(data, "zerops")
            ? [data.zerops]
            : [];
        })
      : [],
  );
}

describe("showcase scene variants", () => {
  it.each(listShowcaseScenes())("$id decodes without every optional field", (scene) => {
    const encoded = asRecord(withoutOptionals(scene));
    const decoded = decodeScene(encoded);

    expect(encoded.steps).toBeUndefined();
    expect(decoded.topologySource.project.publicZone).toBeUndefined();
    expect(decoded.topologySource.project.zeropsSubdomainHost).toBeUndefined();
    expect(decoded.topologySource.services.every((service) => service.isSystem === undefined)).toBe(
      true,
    );
    expect(decoded.lifecycle.envelope).toBeUndefined();
    expect(decoded.lifecycle.updatedAt).toBeUndefined();
    expect(decoded.agentAuth.reason).toBeUndefined();
    expect(decoded.agentAuth.agents.every((agent) => agent.login === undefined)).toBe(true);
    expect(decoded.projects.every((project) => project.repositoryIdentity === undefined)).toBe(
      true,
    );
    expect(decoded.threads.every((thread) => thread.linkedPullRequest === undefined)).toBe(true);
    expect(
      Object.values(decoded.threadActivities)
        .flat()
        .every((activity) => activity.sequence === undefined),
    ).toBe(true);
    for (const result of activityResults(encoded)) {
      expect(Object.keys(decodeActivityResult(result))).toEqual(["toolName"]);
    }
  });

  it.each(listShowcaseScenes())("$id accepts extra fields and every open vocabulary", (scene) => {
    const encoded = asRecord(withUnknownShape(scene));
    // Showcase files use `onExcessProperty: "error"`; the feed/wire decoder under test here uses
    // Effect Schema's lenient default so a newer producer cannot blank an older client.
    const decoded = decodeScene(encoded);

    expect(encoded.newerShape).toBe(true);
    expect(asRecord(encoded.source).newerShape).toBe(true);
    expect(asRecord(encoded.topologySource).newerShape).toBe(true);
    expect(
      decoded.topologySource.services.every((service) => service.status === "FUTURE_STATUS"),
    ).toBe(true);
    expect(decoded.lifecycle.envelope?.phase).toBe("future-phase");
    expect(decoded.lifecycle.envelope?.idleScenario).toBe("future-idle");
    for (const result of activityResults(encoded)) {
      expect(() => decodeActivityResult(result)).not.toThrow();
      expect(asRecord(result).newerShape).toBe(true);
    }
  });

  const closedEnumVariants = [
    ["agentId", withUnknownClosedAgentId],
    ["state", withUnknownClosedAgentAuthState],
    ["phase", withUnknownClosedAgentLoginPhase],
    ["status", withUnknownClosedToolStatus],
  ] as const;

  describe.each(listShowcaseScenes())("$id closed vocabularies", (scene) => {
    it.each(closedEnumVariants)("rejects an unknown %s", (field, variant) => {
      expect(() => decodeScene(variant(scene))).toThrowError(new RegExp(`\\["${field}"\\]`, "u"));
    });
  });

  it.each(listShowcaseScenes())(
    "$id drops one undecodable envelope service and keeps the rest",
    (scene) => {
      const encoded = asRecord(withUndecodableArrayElement(scene));
      const lifecycle = asRecord(encoded.lifecycle);
      const envelope = asRecord(lifecycle.envelope);
      expect(Array.isArray(envelope.services)).toBe(true);
      const encodedServices = envelope.services as ReadonlyArray<unknown>;
      const expectedHostnames = encodedServices.flatMap((service) => {
        if (!Predicate.isObject(service) || Array.isArray(service)) {
          return [];
        }
        return typeof service.hostname === "string" ? [service.hostname] : [];
      });
      const decodedServices = decodeScene(encoded).lifecycle.envelope?.services ?? [];

      expect(decodedServices).toHaveLength(encodedServices.length - 1);
      expect(decodedServices.map(({ hostname }) => hostname)).toEqual(expectedHostnames);
    },
  );
});
