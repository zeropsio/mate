import { ConnectionOnboarding } from "@t3tools/client-runtime/connection";
import {
  createAtomCommandScheduler,
  createRuntimeCommand,
} from "@t3tools/client-runtime/state/runtime";
import * as Effect from "effect/Effect";

import { connectionAtomRuntime } from "./runtime";

const onboardingScheduler = createAtomCommandScheduler();

/**
 * The Zerops door. Single-flight on the container's base URL so a double click
 * cannot mint two grants for the same environment.
 *
 * `doorToken` is a throwaway minted for this one Mate and deleted the moment
 * the door answers (`zerops/doorThrowaway.ts`); the person's own Zerops token
 * never reaches a container.
 */
export const connectZeropsIdentity = createRuntimeCommand(connectionAtomRuntime, {
  label: "web:connection:connect-zerops-identity",
  scheduler: onboardingScheduler,
  concurrency: {
    mode: "singleFlight",
    key: (input: { readonly httpBaseUrl: string }) => input.httpBaseUrl,
  },
  execute: (input: {
    readonly httpBaseUrl: string;
    readonly doorToken: string;
    readonly expectedProjectId?: string;
  }) =>
    ConnectionOnboarding.pipe(
      Effect.flatMap((onboarding) => onboarding.registerZeropsIdentity(input)),
    ),
});
