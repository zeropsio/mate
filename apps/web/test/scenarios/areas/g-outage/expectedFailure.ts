import { afterAll, expect } from "vite-plus/test";
import * as Effect from "effect/Effect";

const targets: { name: string; reached: boolean }[] = [];
// Vitest includes afterEach failures in .fails inversion; the suite hook remains outside it.
afterAll(() => {
  for (const target of targets.splice(0)) {
    expect(target.reached, `Expected-failure setup did not reach: ${target.name}`).toBe(true);
  }
});

export function expectedFailureTarget(name: string) {
  const target = { name, reached: false };
  targets.push(target);
  return <A, E, R>(assertion: Effect.Effect<A, E, R>) =>
    Effect.gen(function* () {
      target.reached = true;
      return yield* assertion;
    });
}
