/**
 * How a person says a declared Zerops service type: what kind of service it is and which
 * version, for every surface that names a service by its type.
 */

/** A service type for people: `postgresql@17` → postgresql, `valkey:single` → valkey. */
export function typeWord(serviceType: string | null): string | null {
  return serviceType === null ? null : (serviceType.split(/[@:]/u)[0] ?? null);
}

export const RUNTIME_WORDS: Readonly<Record<string, string>> = {
  alpine: "Container",
  bun: "Bun app",
  deno: "Deno app",
  docker: "Docker container",
  dotnet: ".NET app",
  elixir: "Elixir app",
  gleam: "Gleam app",
  go: "Go app",
  java: "Java app",
  nginx: "Static site",
  nodejs: "Node.js app",
  php: "PHP app",
  "php-apache": "PHP app",
  "php-nginx": "PHP app",
  python: "Python app",
  ruby: "Ruby app",
  rust: "Rust app",
  static: "Static site",
  ubuntu: "Container",
};

export type VaultServiceKind = "app" | "database" | "cache" | "search" | "storage" | "messaging";

export const MANAGED_WORDS: Readonly<
  Record<string, { readonly kind: VaultServiceKind; readonly words: string }>
> = {
  clickhouse: { kind: "database", words: "Analytics database · ClickHouse" },
  elasticsearch: { kind: "search", words: "Search · Elasticsearch" },
  kafka: { kind: "messaging", words: "Messaging · Kafka" },
  keydb: { kind: "cache", words: "Cache · KeyDB" },
  mariadb: { kind: "database", words: "Database · MariaDB" },
  meilisearch: { kind: "search", words: "Search · Meilisearch" },
  mongodb: { kind: "database", words: "Database · MongoDB" },
  mysql: { kind: "database", words: "Database · MySQL" },
  nats: { kind: "messaging", words: "Messaging · NATS" },
  "object-storage": { kind: "storage", words: "File storage" },
  postgresql: { kind: "database", words: "Database · PostgreSQL" },
  qdrant: { kind: "database", words: "Vector database · Qdrant" },
  rabbitmq: { kind: "messaging", words: "Messaging · RabbitMQ" },
  redis: { kind: "cache", words: "Cache · Redis" },
  "shared-storage": { kind: "storage", words: "Shared disk" },
  typesense: { kind: "search", words: "Search · Typesense" },
  valkey: { kind: "cache", words: "Cache · Valkey" },
};

/**
 * A declared service type as a person reads it, with its version: `postgresql@18` → "Database ·
 * PostgreSQL 18", `nodejs@22` → "Node.js app 22"; a type nobody named here stays as written.
 */
export function serviceTypeWords(serviceType: string): string {
  const type = typeWord(serviceType) ?? serviceType;
  const words = MANAGED_WORDS[type]?.words ?? RUNTIME_WORDS[type] ?? type;
  const version = serviceType.split("@")[1]?.trim();
  return version === undefined || version === "" || version === "latest"
    ? words
    : `${words} ${version}`;
}
