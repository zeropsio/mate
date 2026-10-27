/**
 * This page's token locks: one integration token's live read and its project list write at a
 * time, in this page and, through the page's locks, across this browser's tabs.
 */
import { makeTokenWriteLock, type TokenWriteHold } from "@t3tools/client-runtime/zerops";

export const tokenWrites: TokenWriteHold = makeTokenWriteLock(globalThis.navigator?.locks);
