import {
  buildZeropsServiceMap,
  serviceStatusTone,
} from "@t3tools/client-runtime/zerops/serviceMap";
import { zeropsStripState } from "@t3tools/client-runtime/zerops/strip";
import { readZeropsActivityResult } from "@t3tools/client-runtime/zerops/activityResult";
import { readZeropsCardSource } from "@t3tools/client-runtime/zerops/cards/decode";
import { decodeZeropsCard } from "@t3tools/client-runtime/zerops/cards/payloads";
import type { OrchestrationThreadActivity } from "@t3tools/contracts";
import { listShowcaseScenes } from "@t3tools/shared/showcaseScenes";
import { expect, it } from "vite-plus/test";
import * as Predicate from "effect/Predicate";
import { renderToStaticMarkup } from "react-dom/server";

import { ZeropsAgentAuthCard } from "./ZeropsAgentAuthCard";
import { ZeropsStripLine } from "./ZeropsLifecycleStrip";
import { ZeropsServiceMap } from "./ZeropsServiceMap";
import { ZeropsToolCard } from "./ZeropsToolCard";

function activityPayload(activity: OrchestrationThreadActivity) {
  return Predicate.isObject(activity.payload) && !Array.isArray(activity.payload)
    ? (activity.payload as Record<string, unknown>)
    : undefined;
}

it.each(listShowcaseScenes())("$id renders through the web presentation components", (scene) => {
  const markup: Array<string> = [];
  const map = buildZeropsServiceMap(scene.topology, scene.lifecycle);
  const mapMarkup = renderToStaticMarkup(<ZeropsServiceMap view={map} />);
  markup.push(mapMarkup);
  if (map === undefined) {
    expect(mapMarkup, "an unavailable topology is intentionally hidden").toBe("");
  } else {
    expect(mapMarkup).toContain("data-zerops-service-map");
    for (const service of scene.topology.services) {
      expect(mapMarkup).toContain(service.status);
      expect(mapMarkup).toContain(`data-zerops-service-tone="${serviceStatusTone(service)}"`);
      if (service.transient) {
        expect(mapMarkup).toContain("data-zerops-service-transient");
      }
    }
  }

  const thread = scene.threads.find(({ id }) => id === scene.lifecycle.threadId);
  const strip = zeropsStripState(scene.lifecycle, {
    pendingUserInput: thread?.hasPendingUserInput ?? false,
  });
  const stripMarkup = renderToStaticMarkup(<ZeropsStripLine onOpen={() => {}} state={strip} />);
  markup.push(stripMarkup);
  if (strip === undefined) {
    expect(stripMarkup, "a lifecycle without an envelope is intentionally hidden").toBe("");
  } else {
    expect(stripMarkup).toContain(`data-zerops-strip-tone="${strip.tone}"`);
    expect(stripMarkup).toContain(strip.label);
  }

  const authMarkup = renderToStaticMarkup(
    <ZeropsAgentAuthCard onCancel={() => {}} onSignIn={() => {}} snapshot={scene.agentAuth} />,
  );
  markup.push(authMarkup);
  expect(authMarkup).toContain("data-zerops-agent-auth-card");

  for (const activity of Object.values(scene.threadActivities).flat()) {
    const payload = activityPayload(activity);
    const result = readZeropsActivityResult(payload?.data);
    const card = decodeZeropsCard(
      readZeropsCardSource(result, { failed: payload?.status === "failed" }),
    );
    if (card !== undefined) {
      const cardMarkup = renderToStaticMarkup(<ZeropsToolCard payload={card} />);
      markup.push(cardMarkup);
      expect(cardMarkup).toContain("data-zerops-card");
    }
  }

  expect(markup.join("\n")).not.toContain("undefined");
  expect(markup.join("\n")).not.toContain("[object Object]");
});
