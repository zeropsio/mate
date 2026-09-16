import { ConnectionOnboarding } from "@t3tools/client-runtime/connection";
import {
  createAtomCommandScheduler,
  createRuntimeCommand,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { connectionAtomRuntime } from "./runtime";

const onboardingScheduler = createAtomCommandScheduler();

export const connectPairingUrl = createRuntimeCommand(connectionAtomRuntime, {
  label: "mobile:connection:connect-pairing-url",
  scheduler: onboardingScheduler,
  concurrency: { mode: "singleFlight", key: (pairingUrl: string) => pairingUrl },
  execute: (pairingUrl: string) =>
    ConnectionOnboarding.pipe(
      Effect.flatMap((onboarding) => onboarding.registerPairing({ pairingUrl })),
    ),
});

/**
 * Connects a Zerops container through the Zerops door. `doorToken` is a
 * throwaway minted for this one Mate and deleted the moment the door answers
 * (`zerops/doorThrowaway.ts`): it is spent by the onboarding runtime, never
 * stored with the resulting connection, and the person's own Zerops token
 * never reaches a container at all.
 */
export const connectZeropsIdentity = createRuntimeCommand(connectionAtomRuntime, {
  label: "mobile:connection:connect-zerops-identity",
  scheduler: onboardingScheduler,
  concurrency: {
    mode: "singleFlight",
    key: (input: { readonly httpBaseUrl: string }) => input.httpBaseUrl,
  },
  execute: (input: { readonly httpBaseUrl: string; readonly doorToken: string }) =>
    ConnectionOnboarding.pipe(
      Effect.flatMap((onboarding) => onboarding.registerZeropsIdentity(input)),
    ),
});

export const updateBearerConnection = createRuntimeCommand(connectionAtomRuntime, {
  label: "mobile:connection:update-bearer",
  scheduler: onboardingScheduler,
  concurrency: {
    mode: "serial",
    key: (input: { readonly environmentId: EnvironmentId }) => input.environmentId,
  },
  execute: (input: {
    readonly environmentId: EnvironmentId;
    readonly label: string;
    readonly httpBaseUrl: string;
  }) => ConnectionOnboarding.pipe(Effect.flatMap((onboarding) => onboarding.updateBearer(input))),
});
