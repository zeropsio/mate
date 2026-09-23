import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";

import {
  directTicket,
  identity,
  organization,
  project,
  queryRegistration,
  scope,
} from "../data/__fixtures__/index.ts";
import type { PlatformObservation, ReceiverHandle } from "../data/types.ts";
import { makeFakeDatastream } from "./fakeDatastream.ts";
import { makeFakeZeropsRest } from "./fakeZeropsRest.ts";

const context = { abortSignal: new AbortController().signal, deadlineMs: Number.MAX_SAFE_INTEGER };

function platform() {
  const rest = makeFakeZeropsRest();
  rest.addProject({ id: "project-1", clientId: "org-1", name: "One", status: "ACTIVE" });
  rest.addProject({ id: "project-2", clientId: "org-1", name: "Two", status: "ACTIVE" });
  rest.addProject({ id: "elsewhere", clientId: "org-2", name: "Other", status: "ACTIVE" });
  return rest;
}

const projectIds = (observations: ReadonlyArray<PlatformObservation>) =>
  observations.flatMap((observation) =>
    observation.kind === "project-identity-observed" ? [observation.ref.projectId] : [],
  );

const openReceiver = (datastream: ReturnType<typeof makeFakeDatastream>) =>
  datastream.adapter.openReceiver(scope(), organization, identity().receiver, context);

const projectsOfOrganization = queryRegistration({
  kind: "projects-of-organization",
  organization,
  statuses: [],
  schemaVersion: 1,
});

describe("FakeDatastream", () => {
  it.effect("answers an organization's project baseline from the platform's projects", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const datastream = makeFakeDatastream(platform());
        const receiver: ReceiverHandle = yield* openReceiver(datastream);

        const receipt = yield* datastream.adapter.register(
          receiver,
          projectsOfOrganization,
          context,
        );

        expect(projectIds(receipt.responseObservations)).toEqual(["project-1", "project-2"]);
        expect(datastream.registrations()).toEqual([projectsOfOrganization]);
      }),
    ),
  );

  it.effect("reads a project directly, and one the platform lacks as not found", () =>
    Effect.gen(function* () {
      const datastream = makeFakeDatastream(platform());

      const read = yield* datastream.adapter.read(
        directTicket({ kind: "project", ref: project("project-2") }),
        context,
      );
      const missing = yield* Effect.exit(
        datastream.adapter.read(directTicket({ kind: "project", ref: project("absent") }), context),
      );

      expect(projectIds(read.observations)).toEqual(["project-2"]);
      expect(missing).toEqual(
        Exit.fail(expect.objectContaining({ _tag: "ZeropsDataAdapterError", kind: "not-found" })),
      );
    }),
  );

  it.effect("holds registrations until the test releases them", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const datastream = makeFakeDatastream(platform());
        const receiver = yield* openReceiver(datastream);
        const held = datastream.holdRegistrations();

        const registering = yield* Effect.forkChild(
          datastream.adapter.register(receiver, projectsOfOrganization, context),
        );
        yield* Effect.yieldNow;
        expect(registering.pollUnsafe()).toBeUndefined();

        held.release();
        const receipt = yield* Fiber.join(registering);
        expect(projectIds(receipt.responseObservations)).toEqual(["project-1", "project-2"]);
      }),
    ),
  );
});
