import {
  buildZeropsServiceMap,
  serviceStatusTone,
} from "@t3tools/client-runtime/zerops/serviceMap";
import { zeropsStripState } from "@t3tools/client-runtime/zerops/strip";
import { projectTopology } from "@t3tools/client-runtime/zerops/topology";
import { deriveZeropsThreadModel } from "@t3tools/client-runtime/zerops/model";
import { listShowcaseScenes } from "@t3tools/shared/showcaseScenes";
import { SERVICE_STATUS_TONES, type ServiceStatusToneId } from "@t3tools/shared/brand";
import { expect, it } from "vite-plus/test";
import { renderToStaticMarkup } from "react-dom/server";

import { ZeropsAgentAuthCard } from "./ZeropsAgentAuthCard";
import { ZeropsStripLine } from "./ZeropsLifecycleStrip";
import { ZeropsServiceMap } from "./ZeropsServiceMap";
import { ZeropsOperationCard } from "./ZeropsOperationCard";
import {
  Chip,
  FlatCard,
  KeyChip,
  LivenessLine,
  MicroLabel,
  MintPanel,
  Pill,
  ProcessSteps,
  StatusDot,
} from "./primitives";

it.each(listShowcaseScenes())("$id renders through the web presentation components", (scene) => {
  const markup: Array<string> = [];
  const topologyView = projectTopology(
    scene.topologySource.project,
    scene.topologySource.services,
    scene.topologySource.processes,
  );
  const map = buildZeropsServiceMap(topologyView, scene.lifecycle);
  const mapMarkup = renderToStaticMarkup(<ZeropsServiceMap view={map} />);
  markup.push(mapMarkup);
  if (map === undefined) {
    expect(mapMarkup, "an unavailable topology is intentionally hidden").toBe("");
  } else {
    expect(mapMarkup).toContain("data-zerops-service-map");
    for (const service of topologyView.services) {
      expect(mapMarkup).toContain(service.status);
      expect(mapMarkup).toContain(`data-zerops-service-tone="${serviceStatusTone(service)}"`);
      if (service.transient) {
        expect(mapMarkup).toContain("data-zerops-service-transient");
      }
    }
  }

  const thread = scene.threads.find(({ id }) => id === scene.lifecycle.threadId);
  const lifecycleThreadModel = deriveZeropsThreadModel({
    activities: scene.threadActivities[scene.lifecycle.threadId] ?? [],
    lifecycle: scene.lifecycle,
    runningTurnId: null,
  });
  const strip = zeropsStripState(
    lifecycleThreadModel.session,
    lifecycleThreadModel.running,
    thread?.hasPendingUserInput ?? false,
  );
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

  for (const [threadId, activities] of Object.entries(scene.threadActivities)) {
    const model =
      threadId === scene.lifecycle.threadId
        ? lifecycleThreadModel
        : deriveZeropsThreadModel({ activities, runningTurnId: null });
    for (const entry of model.entries) {
      if (entry.kind !== "operation") continue;
      const cardMarkup = renderToStaticMarkup(<ZeropsOperationCard operation={entry.operation} />);
      markup.push(cardMarkup);
      expect(cardMarkup).toContain("data-zerops-card");
    }
  }

  expect(markup.join("\n")).not.toContain("undefined");
  expect(markup.join("\n")).not.toContain("[object Object]");
});

it("renders the complete primitive probe from existing showcase facts", () => {
  const scenes = listShowcaseScenes();
  const probesByTone = new Map<
    ServiceStatusToneId,
    { readonly label: string; readonly tone: ServiceStatusToneId }
  >();
  const addProbe = (tone: ServiceStatusToneId, label: string) => {
    if (!probesByTone.has(tone)) probesByTone.set(tone, { label, tone });
  };

  for (const scene of scenes) {
    // "web:no-zerops" is the one scripted scene standing in for an
    // environment outside Zerops mode - the closest surviving proxy for what
    // used to be the topology feed's `available: false`.
    if (scene.id === "web:no-zerops") addProbe("off", scene.title);
    for (const tool of scene.lifecycle.recentTools) {
      if (tool.status === "inProgress") addProbe("busy", `${tool.toolName} running`);
    }
    for (const agent of scene.agentAuth.agents) {
      if (agent.state === "not-authorized") {
        addProbe("attention", `${agent.agentId} needs authorization`);
      }
    }
    for (const service of scene.topologySource.services) {
      addProbe(
        /FAIL/u.test(service.status) ? "failed" : "ok",
        `${service.name} ${service.status.toLowerCase()}`,
      );
    }
  }

  const toneProbes = [...probesByTone.values()];
  const toneMarkup = toneProbes
    .flatMap(({ label, tone }) => [
      renderToStaticMarkup(<StatusDot key={`dot-${tone}`} label={label} tone={tone} />),
      renderToStaticMarkup(<Chip key={`chip-${tone}`} label={label} tone={tone} />),
    ])
    .join("\n");
  const processMarkup = scenes
    .filter((scene) => scene.topologySource.services.length > 0)
    .map((scene) =>
      renderToStaticMarkup(
        <ProcessSteps
          steps={scene.topologySource.services.map((service) => ({
            id: `${scene.id}:${service.name}`,
            label: service.name,
            state: /FAIL/u.test(service.status)
              ? ("failed" as const)
              : service.status === "CREATING"
                ? ("running" as const)
                : ("done" as const),
            stateLabel: service.status.toLowerCase(),
          }))}
        />,
      ),
    )
    .join("\n");
  const livenessMarkup = scenes
    .map((scene) =>
      // The doorbell/availability liveness distinction lived on the deleted
      // server topology feed; the client projection carries no equivalent
      // signal, so every scripted scene renders as simply "live" here.
      renderToStaticMarkup(<LivenessLine label={scene.title} state="live" />),
    )
    .join("\n");
  const primitivesMarkup = scenes
    .flatMap((scene) => [
      renderToStaticMarkup(<MicroLabel>{scene.title}</MicroLabel>),
      renderToStaticMarkup(<Pill label={scene.title} />),
      renderToStaticMarkup(<FlatCard>{scene.title}</FlatCard>),
      renderToStaticMarkup(<MintPanel>{scene.title}</MintPanel>),
      renderToStaticMarkup(<KeyChip>{scene.id}</KeyChip>),
    ])
    .join("\n");
  const markup = `${toneMarkup}\n${primitivesMarkup}\n${processMarkup}\n${livenessMarkup}`;

  for (const primitive of [
    "status-dot",
    "micro-label",
    "chip",
    "pill",
    "flat-card",
    "mint-panel",
    "process-steps",
    "key-chip",
    "liveness-line",
  ]) {
    expect(markup).toContain(`data-zerops-primitive="${primitive}"`);
  }
  expect(toneProbes.map(({ tone }) => tone).sort()).toEqual(
    Object.keys(SERVICE_STATUS_TONES).sort(),
  );
  for (const { tone } of toneProbes) {
    expect(markup).toContain(`data-zerops-status-tone="${tone}"`);
    expect(markup).toContain(`data-zerops-chip-tone="${tone}"`);
  }
});
