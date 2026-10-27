/**
 * The app's one reader of each Mate's descriptor (`descriptorShare.ts`): the probe, the exchange
 * driver, the door and the connection's authorization all read through it, so one connect reads
 * the descriptor once.
 */
import { makeDescriptorShare } from "@t3tools/client-runtime/zerops/descriptorShare";
import { systemExchangeClock } from "@t3tools/client-runtime/zerops/environments";

export const mateDescriptors = makeDescriptorShare({
  clock: systemExchangeClock,
  fetch: (url, init) => globalThis.fetch(url, init),
});
