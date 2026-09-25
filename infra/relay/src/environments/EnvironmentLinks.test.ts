import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { PgDialect } from "drizzle-orm/pg-core";

import * as RelayDb from "../db.ts";
import { relayEnvironmentLinks } from "../persistence/schema.ts";
import * as EnvironmentLinks from "./EnvironmentLinks.ts";

describe("EnvironmentLinks", () => {
  it.effect("identifies delivery-user list failures without retaining key material", () => {
    const cause = new Error("database unavailable");
    const fakeDb = {
      select: () => ({
        from: (table: unknown) => {
          expect(table).toBe(relayEnvironmentLinks);
          return {
            where: () => Effect.fail(cause),
          };
        },
      }),
    } as unknown as RelayDb.RelayDb["Service"];

    return Effect.gen(function* () {
      const links = yield* EnvironmentLinks.EnvironmentLinks;
      const error = yield* Effect.flip(
        links.listDeliveryUsersForEnvironment({
          environmentId: "env-1",
          environmentPublicKey: "sensitive-public-key-material",
        }),
      );

      expect(error).toMatchObject({
        _tag: "EnvironmentLinkUserListPersistenceError",
        message: "Environment link user query 'list-delivery-users' failed for environment 'env-1'",
        environmentId: "env-1",
      });
      expect(error.cause).toBe(cause);
      expect(error).not.toHaveProperty("environmentPublicKey");
    }).pipe(
      Effect.provide(
        EnvironmentLinks.layer.pipe(Layer.provide(Layer.succeed(RelayDb.RelayDb, fakeDb))),
      ),
    );
  });

  it.effect("selects notification or Live Activity users by environment key", () => {
    const whereConditions: Array<unknown> = [];
    const fakeDb = {
      select: (selection: unknown) => {
        expect(selection).toBeDefined();
        return {
          from: (table: unknown) => {
            expect(table).toBe(relayEnvironmentLinks);
            return {
              where: (condition: unknown) => {
                whereConditions.push(condition);
                return Effect.succeed([]);
              },
            };
          },
        };
      },
    } as unknown as RelayDb.RelayDb["Service"];

    return Effect.gen(function* () {
      const links = yield* EnvironmentLinks.EnvironmentLinks;
      expect(
        yield* links.listDeliveryUsersForEnvironment({
          environmentId: "env-1",
          environmentPublicKey: "public-key-1",
        }),
      ).toEqual([]);
      expect(whereConditions).toHaveLength(1);

      const query = new PgDialect().sqlToQuery(whereConditions[0] as never);
      expect(query.sql).toContain('"relay_environment_links"."environment_id" = $1');
      expect(query.sql).toContain('"relay_environment_links"."revoked_at" is null');
      expect(query.sql).toContain('"relay_environment_links"."notifications_enabled" = $2');
      expect(query.sql).toContain('"relay_environment_links"."live_activities_enabled" = $3');
      expect(query.sql).toContain('"relay_environment_links"."environment_public_key" = $4');
      expect(query.sql).toContain(" or ");
      expect(query.params).toEqual(["env-1", true, true, "public-key-1"]);
    }).pipe(
      Effect.provide(
        EnvironmentLinks.layer.pipe(Layer.provide(Layer.succeed(RelayDb.RelayDb, fakeDb))),
      ),
    );
  });
});
