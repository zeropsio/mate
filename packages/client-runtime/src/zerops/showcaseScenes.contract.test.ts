/**
 * Consumer contract coverage currently has one real Zerops presentation consumer: web and
 * desktop share these adapters. Mobile is deferred until its S5-3 Zerops surfaces exist, and the
 * relay adapter presents thread-status awareness rather than any Zerops scene field.
 */
import { type OrchestrationThreadActivity } from "@t3tools/contracts";
import {
  listShowcaseScenes,
  type ShowcaseScene,
  ShowcaseSceneJson,
  withoutOptionals,
  withUnknownShape,
} from "@t3tools/shared/showcaseScenes";
import { describe, expect, it } from "vite-plus/test";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

import expectedJson from "./showcaseScenes.contract.expected.json" with { type: "json" };
import { readZeropsActivityResult } from "./activityResult.ts";
import {
  agentAuthAction,
  agentAuthLabel,
  agentLoginLabel,
  classifyAgentLogin,
  zeropsAgentAuthNeedsAttention,
} from "./agentLogin.ts";
import { readZeropsCardSource } from "./cards/decode.ts";
import { decodeZeropsCard } from "./cards/payloads.ts";
import { zeropsQuickActions } from "./quickActions.ts";
import { buildZeropsServiceMap, serviceStatusTone } from "./serviceMap.ts";
import { zeropsStripState } from "./strip.ts";
import { projectTopology } from "./topology.ts";

const expected: Readonly<Record<string, unknown>> = expectedJson;
const CARD_KINDS = [
  "browser",
  "deploy",
  "devServer",
  "error",
  "import",
  "mount",
  "plan",
  "subdomain",
  "verify",
] as const;
const STRIP_TONES = ["active", "done", "idle", "waiting"] as const;
const decodeScene = Schema.decodeUnknownSync(ShowcaseSceneJson);

/**
 * Mirrors `topology.ts`'s own private settled-status set: a status outside it
 * makes a service `transient`, so `serviceStatusTone` falls back to the
 * "warning" tone below. Kept local rather than exported from the client
 * projection - this file is the one place that still needs to name it.
 */
const SETTLED_STATUSES: ReadonlySet<string> = new Set([
  "ACTIVE",
  "RUNNING",
  "STOPPED",
  "READY_TO_DEPLOY",
  "FAILED",
  "DELETED",
  "ACTION_FAILED",
  "CONTAINER_FAILED",
  "REPAIR_FAILED",
]);

function activityPayload(activity: OrchestrationThreadActivity) {
  return Predicate.isObject(activity.payload) && !Array.isArray(activity.payload)
    ? (activity.payload as Record<string, unknown>)
    : undefined;
}

function sceneLifecycles(scene: ShowcaseScene) {
  return [
    { name: "lifecycle", lifecycle: scene.lifecycle },
    ...(scene.steps ?? []).flatMap((step, index) =>
      step.lifecycle === undefined
        ? []
        : [{ name: `steps[${index}].lifecycle`, lifecycle: step.lifecycle }],
    ),
  ];
}

function expectKnownPhaseTotality(scene: ShowcaseScene): void {
  for (const { name, lifecycle } of sceneLifecycles(scene)) {
    const envelope = lifecycle.envelope;
    for (const pendingUserInput of [false, true]) {
      const strip = zeropsStripState(lifecycle, { pendingUserInput });
      if (envelope === undefined) {
        expect(strip, `${scene.id} ${name}: no envelope has no strip`).toBeUndefined();
        continue;
      }
      expect(strip, `${scene.id} ${name}: an envelope resolves to a strip`).toBeDefined();
      if (strip !== undefined) {
        expect(STRIP_TONES).toContain(strip.tone);
        expect(strip.label.length).toBeGreaterThan(0);
        expect(
          strip.label,
          `${scene.id} ${name}: ${envelope.phase} hit the default branch`,
        ).not.toBe(envelope.phase);
      }
    }
  }
}

function scenePresentation(scene: ShowcaseScene) {
  const view = projectTopology(
    scene.topologySource.project,
    scene.topologySource.services,
    scene.topologySource.processes,
  );
  const map = buildZeropsServiceMap(view, scene.lifecycle);
  const strips = sceneLifecycles(scene).flatMap(({ lifecycle }) =>
    [false, true].map((pendingUserInput) => zeropsStripState(lifecycle, { pendingUserInput })),
  );

  for (const service of view.services) {
    const tone = serviceStatusTone(service);
    const known = SETTLED_STATUSES.has(service.status);
    expect(["error", "outline", "warning"]).toContain(tone);
    if (!known && !/FAIL/u.test(service.status)) {
      expect(tone, `${scene.id}: unknown service status must use the warning fallback`).toBe(
        "warning",
      );
    }
  }

  for (const strip of strips) {
    if (strip !== undefined) {
      expect(STRIP_TONES).toContain(strip.tone);
      expect(strip.label.length).toBeGreaterThan(0);
    }
  }

  const agents = scene.agentAuth.agents.map((agent) => {
    const login = classifyAgentLogin(agent.login);
    const authLabel = agentAuthLabel(agent);
    const authAction = agentAuthAction(agent);
    expect(authLabel.length).toBeGreaterThan(0);
    expect(["checking", "none", "registering", "sign-in"]).toContain(authAction);
    expect([
      "awaiting-browser",
      "awaiting-code",
      "failed",
      "menu",
      "none",
      "starting",
      "succeeded",
    ]).toContain(login.kind);
    return {
      agentId: agent.agentId,
      authAction,
      authLabel,
      loginKind: login.kind,
      loginLabel: agentLoginLabel(login),
    };
  });

  const cards = Object.values(scene.threadActivities)
    .flat()
    .map((activity) => {
      const payload = activityPayload(activity);
      const result = readZeropsActivityResult(payload?.data);
      const source = readZeropsCardSource(result, { failed: payload?.status === "failed" });
      const card = decodeZeropsCard(source);
      if (card !== undefined) {
        expect(CARD_KINDS).toContain(card.kind);
      }
      return { activityId: activity.id, kind: card?.kind ?? "generic" };
    });

  return {
    map:
      map === undefined
        ? { kind: "hidden" }
        : {
            kind: "visible",
            groups: map.groups.map((group) => group.title),
            serviceTones: view.services.map(
              (service) => `${service.hostname}:${service.status}:${serviceStatusTone(service)}`,
            ),
          },
    strips: strips.map((strip) => (strip === undefined ? null : `${strip.tone}:${strip.label}`)),
    agents,
    agentAuthNeedsAttention: zeropsAgentAuthNeedsAttention(scene.agentAuth),
    quickActions: zeropsQuickActions(view).map(({ id, label }) => `${id}:${label}`),
    cards: cards.map(({ activityId, kind }) => `${activityId}:${kind}`),
  };
}

describe("showcase scene presentation contract", () => {
  const scenes = listShowcaseScenes();
  const expectationKeys = scenes.flatMap(({ id }) => [
    id,
    `${id}#withoutOptionals`,
    `${id}#withUnknownShape`,
  ]);

  function expectCheckedInPresentation(id: string, presentation: unknown): void {
    const message = Object.hasOwn(expected, id)
      ? `${id}: expectation value drifted`
      : `${id}: missing entry; add the expectation`;
    expect(expected[id], message).toEqual(presentation);
  }

  it("has checked-in base and generated expectations for every scene", () => {
    expect(Object.keys(expected)).toEqual(expectationKeys);
  });

  it.each(scenes)("$id runs through every public Zerops presentation adapter", (scene) => {
    expectCheckedInPresentation(scene.id, scenePresentation(scene));
  });

  it.each(scenes)("$id resolves every base and step phase without the default branch", (scene) => {
    expectKnownPhaseTotality(scene);
  });

  it.each(scenes)(
    "$id#withoutOptionals explicitly has no strip after removing its optional envelope",
    (scene) => {
      const without = decodeScene(withoutOptionals(scene));
      const presentation = scenePresentation(without);

      expect(without.lifecycle.envelope).toBeUndefined();
      expect(presentation.strips).toEqual([null, null]);
      expectCheckedInPresentation(`${scene.id}#withoutOptionals`, presentation);
    },
  );

  it.each(scenes)("$id#withUnknownShape pins the raw phase fallback", (scene) => {
    const unknown = decodeScene(withUnknownShape(scene));
    const envelope = unknown.lifecycle.envelope;
    const strip = zeropsStripState(
      { ...unknown.lifecycle, recentTools: [] },
      { pendingUserInput: false },
    );

    expect(envelope).toBeDefined();
    expect(strip?.tone).toBe("idle");
    expect(strip?.label).toBe(envelope?.phase);
    expectCheckedInPresentation(`${scene.id}#withUnknownShape`, scenePresentation(unknown));
  });
});
