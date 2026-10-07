/**
 * The tab's one reader of each Mate's descriptor (`descriptorShare.ts`): the probe, the exchange
 * driver, the door and the connection's authorization all read through it, so one connect reads
 * the descriptor once.
 */
import { makeBrowserMateDescriptors } from "@t3tools/client-runtime/data";
import { systemExchangeClock } from "@t3tools/client-runtime/zerops/environments";

export const mateDescriptors = makeBrowserMateDescriptors(systemExchangeClock);
