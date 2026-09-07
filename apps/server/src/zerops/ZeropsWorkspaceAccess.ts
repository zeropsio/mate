/** Execution-local remote binding: historical reads must not race a reused hostname. */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import type { ZeropsRepository } from "./ZeropsRepositorySource.ts";

export const CurrentZeropsRepository = Context.Reference<ZeropsRepository | undefined>(
  "t3/zerops/CurrentZeropsRepository",
  { defaultValue: () => undefined },
);

export const withRepository = <A, E, R>(
  repository: ZeropsRepository,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> => Effect.provideService(effect, CurrentZeropsRepository, repository);

export const shellQuote = (token: string): string =>
  /^[A-Za-z0-9_@%+=:,./-]+$/u.test(token) && token.length > 0
    ? token
    : `'${token.replaceAll("'", `'\\''`)}'`;

export const identityGuard = (identity: NonNullable<ZeropsRepository["identity"]>): string =>
  `[ "\${projectId-}" = ${shellQuote(identity.projectId)} ] && ` +
  `[ "\${serviceId-}" = ${shellQuote(identity.serviceId)} ] || ` +
  `{ printf '%s\\n' 'Mate remote workspace identity mismatch' >&2; exit 126; }; `;

export const SSH_PINNED_OPTIONS: ReadonlyArray<string> = [
  "ControlMaster=auto",
  "ControlPath=/tmp/ssh-mux-%r@%h:%p",
  "ControlPersist=600",
  "BatchMode=yes",
  "StrictHostKeyChecking=no",
  "UserKnownHostsFile=/dev/null",
  "LogLevel=ERROR",
  "ConnectTimeout=5",
  "ConnectionAttempts=1",
  "ServerAliveInterval=5",
  "ServerAliveCountMax=2",
];
export const sshArguments = (host: string, command: string): ReadonlyArray<string> => [
  "-l",
  "zerops",
  ...SSH_PINNED_OPTIONS.flatMap((option) => ["-o", option]),
  host,
  command,
];
