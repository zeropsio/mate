/**
 * A place's services as its page lists them: a compact row each, its CPU and RAM beside it — or,
 * for a service that only stores (object storage, shared storage, a local volume), its kind alone:
 * it holds no cores or memory a meter could fill.
 *
 * Pure: no React.
 */

/** The platform's types of a service that stores and runs nothing. */
const STORAGE_TYPES = new Set([
  "objectstorage",
  "object-storage",
  "sharedstorage",
  "local-storage",
]);

/** Whether a service of `type` (`nodejs@22`, `objectstorage`) only stores. */
export function storesOnly(type: string): boolean {
  const base = type.toLowerCase().split(/[@:]/u)[0] ?? "";
  return STORAGE_TYPES.has(base);
}

/** What a service's row says beside its name: its CPU and RAM, or its kind alone. */
export type ServiceRowReading =
  | { readonly kind: "meters" }
  | { readonly kind: "storage"; readonly words: string };

export function serviceRowReading(service: {
  readonly type: string;
  readonly typeShort?: string | undefined;
}): ServiceRowReading {
  return storesOnly(service.type)
    ? { kind: "storage", words: service.typeShort ?? "Storage" }
    : { kind: "meters" };
}
