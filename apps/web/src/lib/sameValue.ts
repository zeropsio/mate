import * as Equal from "effect/Equal";

/**
 * Whether two values a derivation built hold the same: what `Equal.equals`
 * says of plain data, read without hashing it. Derived data rebuilt on every
 * streamed update mostly holds the same entries and messages by identity, so
 * an identical branch ends the walk at once; hashing each fresh value walked
 * every output and every long text it holds, on every update. What is not
 * plain data — a Map, a Date, something with its own equality — is
 * `Equal.equals`'s to say.
 */
export function sameValue(a: unknown, b: unknown, depth = 0): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return typeof a === "number" && typeof b === "number" && Number.isNaN(a) && Number.isNaN(b);
  }
  // Data this deep is no row's: whatever it is, the general rule reads it.
  if (depth > 32) return Equal.equals(a, b);
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let index = 0; index < a.length; index += 1) {
      if (!sameValue(a[index], b[index], depth + 1)) return false;
    }
    return true;
  }
  if (!isPlainRecord(a) || !isPlainRecord(b)) return Equal.equals(a, b);
  const keys = Reflect.ownKeys(a);
  if (keys.length !== Reflect.ownKeys(b).length) return false;
  for (const key of keys) {
    if (!Object.hasOwn(b, key)) return false;
    if (
      !sameValue(
        (a as Record<PropertyKey, unknown>)[key],
        (b as Record<PropertyKey, unknown>)[key],
        depth + 1,
      )
    )
      return false;
  }
  return true;
}

function isPlainRecord(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return (proto === Object.prototype || proto === null) && !(Equal.symbol in value);
}
