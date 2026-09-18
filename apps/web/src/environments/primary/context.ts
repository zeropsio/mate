import {
  attachEnvironmentDescriptor,
  createKnownEnvironment,
  type KnownEnvironment,
} from "@t3tools/client-runtime/environment";
import type { ExecutionEnvironmentDescriptor } from "@t3tools/contracts";
import { normalizeBasePath } from "@t3tools/shared/basePath";
import * as Effect from "effect/Effect";

import { appBasePath } from "../../basePath.ts";

import { PrimaryEnvironmentRequestError, retryTransientBootstrap } from "./auth";
import { PrimaryEnvironmentHttpClient } from "./httpClient";

import { runPrimaryHttp } from "../../lib/runtime";
import { readPrimaryEnvironmentTarget } from "./target";

/**
 * The bundle is talking to a server published under a different path prefix
 * than the one it was built for.
 *
 * That mistake is otherwise invisible: the server answers, the descriptor
 * decodes, and the client goes on to drive an environment nobody meant it to
 * reach. The descriptor states the prefix so this can be caught at bootstrap.
 */
export class PrimaryEnvironmentBasePathMismatchError extends Error {
  override readonly name = "PrimaryEnvironmentBasePathMismatchError";
  constructor(
    readonly clientBasePath: string,
    readonly serverBasePath: string,
  ) {
    super(
      `This client is served under ${clientBasePath || "/"} but the environment it reached is published under ${serverBasePath || "/"}.`,
    );
  }
}

export const isPrimaryEnvironmentBasePathMismatchError = (
  error: unknown,
): error is PrimaryEnvironmentBasePathMismatchError =>
  error instanceof PrimaryEnvironmentBasePathMismatchError;

let primaryEnvironmentDescriptor: ExecutionEnvironmentDescriptor | null = null;
let primaryEnvironmentDescriptorPromise: Promise<ExecutionEnvironmentDescriptor> | null = null;

function createPrimaryKnownEnvironment(input: {
  readonly source: KnownEnvironment["source"];
  readonly target: KnownEnvironment["target"];
}): KnownEnvironment | null {
  const descriptor = readPrimaryEnvironmentDescriptor();
  if (!descriptor) {
    return null;
  }

  return attachEnvironmentDescriptor(
    createKnownEnvironment({
      id: descriptor.environmentId,
      label: descriptor.label,
      source: input.source,
      target: input.target,
    }),
    descriptor,
  );
}

async function fetchPrimaryEnvironmentDescriptor(): Promise<ExecutionEnvironmentDescriptor> {
  return retryTransientBootstrap(async () => {
    let descriptor: ExecutionEnvironmentDescriptor;
    try {
      descriptor = await runPrimaryHttp(
        PrimaryEnvironmentHttpClient.pipe(Effect.flatMap((client) => client.metadata.descriptor())),
      );
    } catch (error) {
      throw PrimaryEnvironmentRequestError.fromCause({
        operation: "fetch-environment-descriptor",
        cause: error,
      });
    }

    // Older servers state no prefix; only a stated one that disagrees is a fault.
    if (descriptor.basePath !== undefined) {
      const clientBasePath = appBasePath();
      const serverBasePath = normalizeBasePath(descriptor.basePath);
      if (serverBasePath !== clientBasePath) {
        throw new PrimaryEnvironmentBasePathMismatchError(clientBasePath, serverBasePath);
      }
    }

    writePrimaryEnvironmentDescriptor(descriptor);
    return descriptor;
  });
}

function readPrimaryEnvironmentDescriptor(): ExecutionEnvironmentDescriptor | null {
  return primaryEnvironmentDescriptor;
}

export function writePrimaryEnvironmentDescriptor(
  descriptor: ExecutionEnvironmentDescriptor | null,
): void {
  primaryEnvironmentDescriptor = descriptor;
}

export function getPrimaryKnownEnvironment(): KnownEnvironment | null {
  const primaryTarget = readPrimaryEnvironmentTarget();
  if (!primaryTarget) {
    return null;
  }

  return createPrimaryKnownEnvironment({
    source: primaryTarget.source,
    target: primaryTarget.target,
  });
}

export function resolveInitialPrimaryEnvironmentDescriptor(): Promise<ExecutionEnvironmentDescriptor> {
  const descriptor = readPrimaryEnvironmentDescriptor();
  if (descriptor) {
    return Promise.resolve(descriptor);
  }

  if (primaryEnvironmentDescriptorPromise) {
    return primaryEnvironmentDescriptorPromise;
  }

  const nextPromise = fetchPrimaryEnvironmentDescriptor();
  primaryEnvironmentDescriptorPromise = nextPromise;
  return nextPromise.finally(() => {
    if (primaryEnvironmentDescriptorPromise === nextPromise) {
      primaryEnvironmentDescriptorPromise = null;
    }
  });
}

export function __resetPrimaryEnvironmentBootstrapForTests(): void {
  primaryEnvironmentDescriptorPromise = null;
  primaryEnvironmentDescriptor = null;
}

export const resetPrimaryEnvironmentDescriptorForTests = __resetPrimaryEnvironmentBootstrapForTests;

export const __resetPrimaryEnvironmentDescriptorBootstrapForTests =
  __resetPrimaryEnvironmentBootstrapForTests;
