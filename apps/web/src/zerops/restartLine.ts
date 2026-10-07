/** Restart jokes describe the wait; animation cycles change copy, never readiness. */
export const RESTART_LINES = [
  (name: string) => `${name} is trying the classic off-and-on trick.`,
  (name: string) => `${name} is shaking the crumbs out.`,
  (name: string) => `${name} is finding the other end of the power cable.`,
  (name: string) => `${name} is putting its thoughts back in order.`,
  (name: string) => `${name} is stretching before the next round.`,
] as const;

export function restartLine(name: string, cycle: number): string {
  return RESTART_LINES[cycle % RESTART_LINES.length]!(name.trim() || "The Mate");
}
