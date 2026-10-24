import { TestRunner } from "vite-plus/test";

/**
 * Notes the scenario step the running case entered last; a no-op outside a test. The Signal
 * reporter reads the test meta's `lastStep` to name where a hung case stood.
 */
export function recordStep(step: string): void {
  const test = TestRunner.getCurrentTest();
  if (test) Reflect.set(test.meta, "lastStep", step);
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
