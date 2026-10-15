/** An origin's `localStorage` with a browser's ceiling: a write that would hold more than
 * `capacity` UTF-16 units, keys included, throws the browser's `QuotaExceededError`. */
export function quotaStorage(capacity: number): Storage & { readonly values: Map<string, string> } {
  const values = new Map<string, string>();
  const used = () => {
    let total = 0;
    for (const [key, value] of values) total += key.length + value.length;
    return total;
  };
  return {
    values,
    get length() {
      return values.size;
    },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem(key, value) {
      const previous = values.get(key);
      const replaced = previous === undefined ? 0 : key.length + previous.length;
      if (used() - replaced + key.length + value.length > capacity) {
        throw new DOMException(
          `Failed to execute 'setItem' on 'Storage': Setting the value of '${key}' exceeded the quota.`,
          "QuotaExceededError",
        );
      }
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
    clear: () => values.clear(),
  };
}
