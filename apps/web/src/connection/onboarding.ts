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
    readonly zeropsToken: string;
    readonly expectedProjectId?: string;
  }) =>
    ConnectionOnboarding.pipe(
      Effect.flatMap((onboarding) => onboarding.registerZeropsIdentity(input)),
    ),
});
