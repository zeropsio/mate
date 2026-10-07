/** Local conversation key retained until its composer call site moves. No catalog data is stored. */
export function composerThreadControlKey(threadKey: string): string {
  return `thread\u0000${threadKey}`;
}
