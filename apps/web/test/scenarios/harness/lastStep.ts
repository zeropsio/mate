import { TestRunner } from "vite-plus/test";

/** The test meta key the Signal reporter reads to name where a hung case stood. */
export const LAST_STEP_META = "lastStep";

/** Notes the scenario step the running case entered last; a no-op outside a test. */
export function recordStep(step: string): void {
  const test = TestRunner.getCurrentTest();
  if (test) test.meta[LAST_STEP_META] = step;
}

const isPlain = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));

/**
 * A DSL object whose every call, and every step value read from it, records its path as the
 * running case's last step. Plain objects nest; anything else is a step and is returned as is.
 */
export function trackSteps<T extends Record<string, unknown>>(path: string, target: T): T {
  return new Proxy(target, {
    get(object, key, receiver) {
      const value: unknown = Reflect.get(object, key, receiver);
      if (typeof key !== "string") return value;
      const step = `${path}.${key}`;
      if (isPlain(value)) return trackSteps(step, value);
      if (typeof value === "function")
        return new Proxy(value, {
          apply(fn, self, args) {
            recordStep(step);
            return Reflect.apply(fn, self, args);
          },
        });
      recordStep(step);
      return value;
    },
  });
}
