import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { PlatformSignal } from "@t3tools/client-runtime/zerops/knowledge";

const device = vi.hoisted(() => ({
  appState: "active" as string,
  appStateListeners: [] as Array<(next: string) => void>,
  networkListeners: [] as Array<(state: { readonly isConnected?: boolean }) => void>,
}));

vi.mock("react-native", () => ({
  AppState: {
    get currentState() {
      return device.appState;
    },
    addEventListener: (_event: string, listener: (next: string) => void) => {
      device.appStateListeners.push(listener);
      return {
        remove: () => {
          device.appStateListeners.splice(device.appStateListeners.indexOf(listener), 1);
        },
      };
    },
  },
}));

vi.mock("expo-network", () => ({
  addNetworkStateListener: (listener: (state: { readonly isConnected?: boolean }) => void) => {
    device.networkListeners.push(listener);
    return {
      remove: () => {
        device.networkListeners.splice(device.networkListeners.indexOf(listener), 1);
      },
    };
  },
}));

import { mobilePlatformSignals } from "./platform-signals";

const SECOND = 1_000;

const moveApp = (state: string) => {
  device.appState = state;
  for (const listener of device.appStateListeners) listener(state);
};

const network = (isConnected: boolean | undefined) => {
  for (const listener of device.networkListeners) listener({ isConnected });
};

describe("mobilePlatformSignals", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    device.appState = "active";
    device.appStateListeners.length = 0;
    device.networkListeners.length = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("hears the app leave and return to the foreground, with a wake after a long absence", () => {
    const signals = mobilePlatformSignals();
    const heard: Array<PlatformSignal> = [];
    const stop = signals.listen((signal) => heard.push(signal));

    moveApp("background");
    expect(signals.hidden()).toBe(true);
    vi.advanceTimersByTime(45 * SECOND);
    moveApp("active");

    expect(heard).toEqual([
      { type: "visibility", hidden: true },
      { type: "visibility", hidden: false },
      { type: "wake", visible: true, cause: "shown" },
    ]);
    expect(signals.hidden()).toBe(false);

    stop();
    expect(device.appStateListeners).toHaveLength(0);
    expect(device.networkListeners).toHaveLength(0);
  });

  it("hears the device's network go and come back, and nothing it could not read", () => {
    const signals = mobilePlatformSignals();
    const heard: Array<PlatformSignal> = [];
    signals.listen((signal) => heard.push(signal));

    network(true);
    network(undefined);
    network(false);
    expect(signals.online()).toBe(false);
    network(true);

    expect(heard).toEqual([
      { type: "network", online: false },
      { type: "network", online: true },
      { type: "wake", visible: true, cause: "online" },
    ]);
  });
});
