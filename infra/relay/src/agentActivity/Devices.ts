import type { RelayDeviceRegistrationRequest } from "@t3tools/contracts/relay";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { and, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";

import * as RelayDb from "../db.ts";
import { relayLiveActivities, relayMobileDevices } from "../persistence/schema.ts";

export class DeviceRegistrationPersistenceError extends Schema.TaggedError<DeviceRegistrationPersistenceError>()(
  "DeviceRegistrationPersistenceError",
  {
    userId: Schema.String,
    deviceId: Schema.String,
    stage: Schema.Literals(["claim-push-token", "claim-push-to-start-token", "upsert-device"]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to persist mobile device registration for ${this.userId}/${this.deviceId} during ${this.stage}.`;
  }
}

export class DeviceUnregistrationPersistenceError extends Schema.TaggedError<DeviceUnregistrationPersistenceError>()(
  "DeviceUnregistrationPersistenceError",
  {
    userId: Schema.String,
    deviceId: Schema.String,
    stage: Schema.Literals(["delete-live-activity", "delete-device"]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to unregister mobile device ${this.userId}/${this.deviceId} during ${this.stage}.`;
  }
}

export class Devices extends Context.Service<
  Devices,
  {
    readonly register: (input: {
      readonly userId: string;
      readonly registration: RelayDeviceRegistrationRequest;
    }) => Effect.Effect<void, DeviceRegistrationPersistenceError>;
    readonly unregister: (input: {
      readonly userId: string;
      readonly deviceId: string;
    }) => Effect.Effect<void, DeviceUnregistrationPersistenceError>;
  }
>()("t3code-relay/agentActivity/Devices") {}

export const make = Effect.gen(function* () {
  const db = yield* RelayDb.RelayDb;

  return Devices.of({
    register: Effect.fn("relay.devices.register")(function* (input) {
      yield* Effect.annotateCurrentSpan({
        "relay.mobile.device_id": input.registration.deviceId,
      });
      const updatedAt = DateTime.formatIso(yield* DateTime.now);
      const registration = input.registration;

      // Each drizzle query-builder chain only becomes a real Effect when
      // consumed via `yield*` — handing one to `Effect.all` instead sends the
      // lazy builder itself into the fiber runtime rather than its result.
      // Keep every db chain directly yielded, not batched.
      if (registration.pushToken) {
        yield* db
          .update(relayMobileDevices)
          .set({ pushToken: null, updatedAt })
          .where(eq(relayMobileDevices.pushToken, registration.pushToken))
          .pipe(
            Effect.mapError(
              (cause) =>
                new DeviceRegistrationPersistenceError({
                  userId: input.userId,
                  deviceId: registration.deviceId,
                  stage: "claim-push-token",
                  cause,
                }),
            ),
          );
      }
      if (registration.pushToStartToken) {
        yield* db
          .update(relayMobileDevices)
          .set({ pushToStartToken: null, updatedAt })
          .where(eq(relayMobileDevices.pushToStartToken, registration.pushToStartToken))
          .pipe(
            Effect.mapError(
              (cause) =>
                new DeviceRegistrationPersistenceError({
                  userId: input.userId,
                  deviceId: registration.deviceId,
                  stage: "claim-push-to-start-token",
                  cause,
                }),
            ),
          );
      }

      yield* db
        .insert(relayMobileDevices)
        .values({
          userId: input.userId,
          deviceId: registration.deviceId,
          label: registration.label,
          platform: registration.platform,
          iosMajorVersion: registration.iosMajorVersion,
          appVersion: registration.appVersion ?? null,
          bundleId: registration.bundleId ?? null,
          apsEnvironment: registration.apsEnvironment ?? null,
          pushToken: registration.pushToken ?? null,
          pushToStartToken: registration.pushToStartToken ?? null,
          preferencesJson: registration.preferences,
          createdAt: updatedAt,
          updatedAt,
        })
        .onConflictDoUpdate({
          target: [relayMobileDevices.userId, relayMobileDevices.deviceId],
          set: {
            platform: registration.platform,
            label: registration.label,
            iosMajorVersion: registration.iosMajorVersion,
            appVersion: registration.appVersion ?? null,
            // Preserve routing from newer app builds when an older build
            // re-registers without these fields.
            bundleId: sql`coalesce(excluded.bundle_id, ${relayMobileDevices.bundleId})`,
            apsEnvironment: sql`coalesce(
                excluded.aps_environment,
                ${relayMobileDevices.apsEnvironment}
              )`,
            pushToken: sql`coalesce(excluded.push_token, ${relayMobileDevices.pushToken})`,
            pushToStartToken: sql`coalesce(
                excluded.push_to_start_token,
                ${relayMobileDevices.pushToStartToken}
              )`,
            preferencesJson: registration.preferences,
            updatedAt,
          },
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new DeviceRegistrationPersistenceError({
                userId: input.userId,
                deviceId: registration.deviceId,
                stage: "upsert-device",
                cause,
              }),
          ),
        );
    }),
    unregister: Effect.fn("relay.devices.unregister")(function* (input) {
      yield* Effect.annotateCurrentSpan({
        "relay.mobile.device_id": input.deviceId,
      });
      // Same constraint as register above: db chains must be consumed via
      // `yield*`, never passed to Effect.all.
      yield* db
        .delete(relayLiveActivities)
        .where(
          and(
            eq(relayLiveActivities.userId, input.userId),
            eq(relayLiveActivities.deviceId, input.deviceId),
          ),
        )
        .pipe(
          Effect.mapError(
            (cause) =>
              new DeviceUnregistrationPersistenceError({
                userId: input.userId,
                deviceId: input.deviceId,
                stage: "delete-live-activity",
                cause,
              }),
          ),
        );
      yield* db
        .delete(relayMobileDevices)
        .where(
          and(
            eq(relayMobileDevices.userId, input.userId),
            eq(relayMobileDevices.deviceId, input.deviceId),
          ),
        )
        .pipe(
          Effect.mapError(
            (cause) =>
              new DeviceUnregistrationPersistenceError({
                userId: input.userId,
                deviceId: input.deviceId,
                stage: "delete-device",
                cause,
              }),
          ),
        );
    }),
  });
});

export const layer = Layer.effect(Devices, make);
