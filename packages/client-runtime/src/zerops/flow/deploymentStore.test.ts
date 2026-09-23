import { describe, expect, it } from "vite-plus/test";

import { project, service } from "../data/__fixtures__/index.ts";
import {
  projectKeyOf,
  type CollectionRead,
  type ProjectRef,
  type ServiceRecord,
} from "../data/types.ts";
import { deployed, record, servicesRead } from "./__fixtures__/services.ts";
import { makeDeploymentStore } from "./deploymentStore.ts";

const NOW = 100_000;
const STAGE = project("project-stage");
const PRODUCTION = project("project-production");

/** The data runtime's listings, which the test changes and publishes. */
function listings() {
  const reads = new Map<string, CollectionRead<ServiceRecord>>();
  const watchers = new Map<string, Set<() => void>>();
  return {
    ports: {
      services: (ref: ProjectRef) =>
        reads.get(projectKeyOf(ref)) ??
        servicesRead([], { coverage: { kind: "none" }, project: ref }),
      watch: (ref: ProjectRef, changed: () => void) => {
        const key = projectKeyOf(ref);
        const set = watchers.get(key) ?? new Set();
        watchers.set(key, set.add(changed));
        return () => void set.delete(changed);
      },
      nowMs: () => NOW,
    },
    publish: (ref: ProjectRef, read: CollectionRead<ServiceRecord>) => {
      reads.set(projectKeyOf(ref), read);
      for (const changed of watchers.get(projectKeyOf(ref)) ?? []) changed();
    },
    watching: () => [...watchers.values()].reduce((count, set) => count + set.size, 0),
  };
}

const app = (ref: ProjectRef) =>
  servicesRead([record(`${ref.projectId}-app`, "app", deployed(null), { project: ref })], {
    project: ref,
  });

describe("the deployment store (DESIGN §2.D D6)", () => {
  it("publishes a demanded stop as the platform's listing of it changes", () => {
    const platform = listings();
    const store = makeDeploymentStore(platform.ports);
    const heard: Array<string> = [];
    store.subscribe((ref) => heard.push(ref.projectId));

    expect(store.stop(STAGE).state).toBe("unread");
    store.demand(STAGE);
    platform.publish(STAGE, app(STAGE));

    expect(heard).toEqual(["project-stage"]);
    const stop = store.stop(STAGE);
    expect(stop.state === "known" ? stop.value.map(({ hostname }) => hostname) : []).toEqual([
      "app",
    ]);
    // The same object until the listing changes.
    expect(store.stop(STAGE)).toBe(stop);
  });

  it("shows only what a view demands, and hears nothing once the last demand is released", () => {
    const platform = listings();
    const store = makeDeploymentStore(platform.ports);
    platform.publish(PRODUCTION, app(PRODUCTION));

    expect(store.stop(PRODUCTION).state).toBe("unread");
    const release = store.demand(PRODUCTION);
    expect(store.stop(PRODUCTION).state).toBe("known");
    expect(store.shows(service("project-production-app", PRODUCTION))).toBe(true);
    expect(store.shows(service("project-stage-app", STAGE))).toBe(false);

    release();
    expect(platform.watching()).toBe(0);
    expect(store.stop(PRODUCTION).state).toBe("unread");
  });

  it("a deployment invalidation publishes that service's stop again, and only it", () => {
    const platform = listings();
    const store = makeDeploymentStore(platform.ports);
    store.demand(STAGE);
    store.demand(PRODUCTION);
    platform.publish(STAGE, app(STAGE));
    platform.publish(PRODUCTION, app(PRODUCTION));
    const heard: Array<string> = [];
    store.subscribe((ref) => heard.push(ref.projectId));

    store.invalidate({ topic: "deployment", service: service("project-stage-app", STAGE) });

    expect(heard).toEqual(["project-stage"]);
  });

  it("a disposed store watches nothing and publishes nothing", () => {
    const platform = listings();
    const store = makeDeploymentStore(platform.ports);
    store.demand(STAGE);
    const heard: Array<string> = [];
    store.subscribe((ref) => heard.push(ref.projectId));

    store.dispose();
    platform.publish(STAGE, app(STAGE));

    expect(platform.watching()).toBe(0);
    expect(heard).toEqual([]);
    expect(store.stop(STAGE).state).toBe("unread");
    store.demand(STAGE);
    expect(platform.watching()).toBe(0);
  });
});
