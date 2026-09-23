/**
 * The container store (DESIGN §4.5) as mobile hosts it (§7.5, A10): one per account binding, its
 * intents held in memory, its Mate flag read on the service each listed target names, its wakes
 * the app coming back to the foreground. Every Mate row's container verdict comes from here.
 */
import { readZeropsContainer } from "@t3tools/client-runtime/zerops/containerHealth";
import type { ServiceRef, ZeropsResourceBroker } from "@t3tools/client-runtime/zerops/data";
import {
  makeContainerStore,
  readServiceMateFlag,
  systemExchangeClock,
  type ContainerStore,
  type ContainerStorePorts,
  type ContainerTarget,
  type MateFlag,
  type TargetKey,
} from "@t3tools/client-runtime/zerops/environments";

/** A listed target, with the zcp service its Mate flag is read on. */
export interface MobileContainerTarget extends ContainerTarget {
  readonly service: ServiceRef;
}

/** Whether the app is in the foreground, and each time that changes (`AppState`, §7.5). */
export interface MobileVisibility {
  readonly current: () => boolean;
  readonly subscribe: (listener: (visible: boolean) => void) => () => void;
}

export interface MobileContainerPorts {
  readonly clock: ContainerStorePorts["clock"];
  readonly probe: ContainerStorePorts["probe"];
  readonly readMateFlag: (service: ServiceRef) => Promise<MateFlag>;
  readonly visibility: MobileVisibility;
}

export interface MobileContainers {
  readonly store: ContainerStore;
  /** Every Mate target the listing holds now; a target left out is forgotten. */
  readonly setTargets: (targets: ReadonlyArray<MobileContainerTarget>) => void;
  /** The account closed: the store's probes, reads and timers end. */
  readonly dispose: () => void;
}

/** The ports of the account's own store: the device's clock and fetch, the account's broker. */
export function mobileContainerPorts(
  resources: ZeropsResourceBroker,
  visibility: MobileVisibility,
): MobileContainerPorts {
  return {
    clock: systemExchangeClock,
    probe: (origin, signal) =>
      readZeropsContainer(origin, globalThis.fetch.bind(globalThis), signal),
    readMateFlag: (service) => readServiceMateFlag(resources, service),
    visibility,
  };
}

export function makeMobileContainers(ports: MobileContainerPorts): MobileContainers {
  let services: ReadonlyMap<TargetKey, ServiceRef> = new Map();
  let intents: string | null = null;
  const store = makeContainerStore({
    clock: ports.clock,
    probe: ports.probe,
    readMateFlag: (key) => {
      const service = services.get(key);
      return service === undefined ? Promise.resolve("unknown") : ports.readMateFlag(service);
    },
    intents: {
      read: () => intents,
      write: (value) => {
        intents = value;
      },
    },
  });
  // Backgrounded, the store waits; brought back, it wakes and reads what no socket proves (§6.4).
  store.setVisible(ports.visibility.current());
  const unsubscribe = ports.visibility.subscribe((visible) => {
    store.setVisible(visible);
    if (visible) store.wake(true);
  });
  return {
    store,
    setTargets: (targets) => {
      services = new Map(targets.map((target) => [target.key, target.service]));
      store.setTargets(
        targets.map(({ key, origin, platform }): ContainerTarget => ({ key, origin, platform })),
      );
    },
    dispose: () => {
      unsubscribe();
      store.dispose();
    },
  };
}
