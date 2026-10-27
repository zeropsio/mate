/**
 * The PlatformSignals port on a device (DESIGN §6.4, §7.5): the app in the foreground is the
 * visible tab (`AppState`), the network is the device's (`expo-network`), and a tick finds a
 * sleep — a backgrounded app's timers stop, so its ticks come back as a gap. The account's data
 * provider makes one per account, and every consumer of the account hears the device through it.
 */
import {
  makePlatformSignals,
  SIGNALS_TICK_MS,
  type PlatformSignals,
} from "@t3tools/client-runtime/zerops/knowledge";
import * as Network from "expo-network";
import { AppState, type AppStateStatus } from "react-native";

const hiddenIn = (state: AppStateStatus | null): boolean => state !== "active";

export function mobilePlatformSignals(): PlatformSignals {
  // Online until the device says otherwise: its first reading is asynchronous.
  let online = true;
  return makePlatformSignals({
    hidden: () => hiddenIn(AppState.currentState),
    online: () => online,
    now: () => ({ wall: Date.now(), mono: performance.now() }),
    listen: (hear) => {
      const appState = AppState.addEventListener("change", (state) =>
        hear({ type: "visibility", hidden: hiddenIn(state) }),
      );
      const network = Network.addNetworkStateListener(({ isConnected }) => {
        if (isConnected === undefined || isConnected === online) return;
        online = isConnected;
        hear({ type: online ? "online" : "offline" });
      });
      // One timer at a time, so a suspended app's ticks stay what they are: a gap.
      let timer: ReturnType<typeof setTimeout>;
      const tick = () => {
        hear({ type: "tick" });
        timer = setTimeout(tick, SIGNALS_TICK_MS);
      };
      tick();
      return () => {
        clearTimeout(timer);
        appState.remove();
        network.remove();
      };
    },
  });
}
