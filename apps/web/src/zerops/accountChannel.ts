import type { InvalidationChannel } from "@t3tools/client-runtime/zerops/knowledge";

/** The one channel the tabs of an account share for invalidations (DESIGN §6.7). */
const ACCOUNT_CHANNEL = "mate:account";

/** This tab's end of the account channel; the cross-tab transport that opens it closes it. */
export const openAccountChannel = (): InvalidationChannel => new BroadcastChannel(ACCOUNT_CHANNEL);
