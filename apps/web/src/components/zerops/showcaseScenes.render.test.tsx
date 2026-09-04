import {
  buildZeropsServiceMap,
  serviceStatusTone,
} from "@t3tools/client-runtime/zerops/serviceMap";
import { zeropsStripState } from "@t3tools/client-runtime/zerops/strip";
import type { ZeropsTopologyView } from "@t3tools/client-runtime/zerops/topology";
import { reduceZeropsOperations } from "@t3tools/client-runtime/zerops/operations";
import { callEntriesFromActivities } from "@t3tools/client-runtime/zerops/operations/fixtures";
import { listShowcaseScenes } from "@t3tools/shared/showcaseScenes";
import { SERVICE_STATUS_TONES, type ServiceStatusToneId } from "@t3tools/shared/brand";
import type { ZeropsTopologySnapshot } from "@t3tools/contracts";
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

/**
 * TEMPORARY, deleted once the scene contract itself moves to a captured
 * `service-stack`/`process` pair (a follow-up slice, not S3): reshapes the
 * still-server-shaped `zcp studio topology` scene snapshot
 * (`ZeropsTopologySnapshot`, still read by `apps/server/src/zerops/
 * ZeropsFixtureFeeds.ts` until S4 deletes that feed) into the client
 * projection's `ZeropsTopologyView`. Mirrors the identical adapter in
 * `packages/client-runtime/src/zerops/showcaseScenes.contract.test.ts`.
 */
function viewFromScene(snapshot: ZeropsTopologySnapshot): ZeropsTopologyView | undefined {
  if (!snapshot.available) return undefined;
  const project = snapshot.project;
  return {
    project: {
      id: project?.id ?? "showcase-project",
      name: project?.name ?? "Showcase",
      ...(project?.status === undefined ? {} : { status: project.status }),
    },
    services: snapshot.services.map((service) => ({
      hostname: service.hostname,
      serviceId: service.serviceId,
      type: service.type,
      status: service.status,
      group: service.group,
      transient: service.transient,
      ...(service.subdomainUrl === undefined ? {} : { subdomainUrl: service.subdomainUrl }),
      ports: [],
    })),
    warnings: snapshot.warnings,
  };
}

it.each(listShowcaseScenes())("$id renders through the web presentation components", (scene) => {
  const markup: Array<string> = [];
  const topologyView = viewFromScene(scene.topology);
  const map = buildZeropsServiceMap(topologyView, scene.lifecycle);
  const mapMarkup = renderToStaticMarkup(<ZeropsServiceMap view={map} />);
  markup.push(mapMarkup);
  if (map === undefined) {
    expect(mapMarkup, "an unavailable topology is intentionally hidden").toBe("");
  } else {
    expect(mapMarkup).toContain("data-zerops-service-map");
    for (const service of topologyView?.services ?? []) {
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

  for (const activities of Object.values(scene.threadActivities)) {
    const entries = callEntriesFromActivities(activities);
    const { operations } = reduceZeropsOperations(entries);
    for (const operation of operations) {
      const cardMarkup = renderToStaticMarkup(<ZeropsOperationCard operation={operation} />);
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
    if (!scene.topology.available) addProbe("off", scene.title);
    for (const tool of scene.lifecycle.recentTools) {
      if (tool.status === "inProgress") addProbe("busy", `${tool.toolName} running`);
    }
    for (const agent of scene.agentAuth.agents) {
      if (agent.state === "not-authorized") {
        addProbe("attention", `${agent.agentId} needs authorization`);
      }
    }
    for (const service of scene.topology.services) {
      addProbe(
        /FAIL/u.test(service.status) ? "failed" : "ok",
        `${service.hostname} ${service.status.toLowerCase()}`,
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
    .filter((scene) => scene.topology.services.length > 0)
    .map((scene) =>
      renderToStaticMarkup(
        <ProcessSteps
          steps={scene.topology.services.map((service) => ({
            id: `${scene.id}:${service.hostname}`,
            label: service.hostname,
            state: /FAIL/u.test(service.status)
              ? ("failed" as const)
              : service.transient
                ? ("running" as const)
                : ("done" as const),
            stateLabel: service.status.toLowerCase(),
          }))}
        />,
      ),
    )
    .join("\n");
  const livenessMarkup = scenes
    .map((scene) => {
      if (!scene.topology.available) return renderToStaticMarkup(<LivenessLine state="absent" />);
      return scene.topology.doorbellConnected === false
        ? renderToStaticMarkup(
            <LivenessLine label={scene.topology.reason ?? scene.title} state="doorbell-down" />,
          )
        : renderToStaticMarkup(<LivenessLine label={scene.title} state="live" />);
    })
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
