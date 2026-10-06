/**
 * Structural sharing for plain data — what a decoded wire value is: `next`
 * with every part equal to `previous` replaced by `previous`'s own object, and
 * `previous` itself when the whole is equal. A consumer that compares by
 * reference then sees a change only where one happened.
 *
 * Only plain objects (`Object.prototype` or no prototype) and arrays are
 * walked; anything else is equal only when it is the same value (`Object.is`).
 */
export function shareEqual<T>(previous: T, next: T): T {
  return share(previous, next) as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function share(previous: unknown, next: unknown): unknown {
  if (Object.is(previous, next)) return previous;
  if (Array.isArray(previous) && Array.isArray(next)) {
    let equal = previous.length === next.length;
    const out: unknown[] = Array.from({ length: next.length });
    for (let index = 0; index < next.length; index += 1) {
      const shared = index < previous.length ? share(previous[index], next[index]) : next[index];
      out[index] = shared;
      if (equal && shared !== previous[index]) equal = false;
    }
    return equal ? previous : out;
  }
  if (isPlainObject(previous) && isPlainObject(next)) {
    const nextKeys = Object.keys(next);
    let equal = nextKeys.length === Object.keys(previous).length;
    const out: Record<string, unknown> = {};
    for (const key of nextKeys) {
      const had = Object.hasOwn(previous, key);
      const shared = had ? share(previous[key], next[key]) : next[key];
      out[key] = shared;
      if (equal && (!had || shared !== previous[key])) equal = false;
    }
    return equal ? previous : out;
  }
  return next;
}
