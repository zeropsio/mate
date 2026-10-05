import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { MateLinkUp, MateOverview } from "@t3tools/shared/mateLink";
import { overviewOf, mainAt } from "../../../../../hq/test/harness/overviews.ts";
import { deadline } from "../../harness/http.ts";
import type { ScenarioExtension, ScenarioDrivers } from "../../harness/scenario.ts";
import type { Page } from "puppeteer-core";
import { outageConnection } from "../../fakes/g-outage/connection.ts";

const controls = new WeakMap<ScenarioDrivers, Awaited<ReturnType<typeof outageConnection>>>();

export const installArea: ScenarioExtension = async (drivers) => {
  const connection = await outageConnection(drivers.routes["https://hqzone.prg1-zerops.zone"]!);
  drivers.routes["https://hqzone.prg1-zerops.zone"] = connection.origin;
  drivers.cleanup.push(connection.close);
  controls.set(drivers, connection);
};

export function outageControls(drivers: ScenarioDrivers) {
  const connection = controls.get(drivers);
  if (!connection) throw new Error("Install the outage extension before creating fixtures");
  return connection;
}

export const refusedHqRetry = (page: Page) =>
  page.waitForResponse(
    (response) =>
      response.url().includes("/api/stream-ticket") &&
      response.request().method() === "POST" &&
      response.status() === 503,
    { timeout: 10_000 },
  );

export const refusedZeropsRetry = (page: Page) =>
  page.waitForResponse(
    (response) => response.url().includes("api.app-prg1.zerops.io") && response.status() === 503,
    { timeout: 10_000 },
  );

const decodeOverview = Schema.decodeUnknownEffect(MateOverview);
const encodeLink = Schema.encodeEffect(MateLinkUp);

export const reportsWork = Effect.fn("outage.reportsWork")(function* (
  drivers: ScenarioDrivers,
  name: string,
  subject: string,
  question?: string,
) {
  const mate = drivers.mates.get(name)!;
  const overview = yield* decodeOverview({
    ...overviewOf(),
    identity: {
      environmentId: mate.descriptor.environmentId,
      serverVersion: "0.14.11",
      update: null,
    },
    main: {
      ...mainAt("Inspecting checkout"),
      id: mate.thread.id,
      title: subject,
      latestUserMessageAt: "2026-10-06T08:00:00.000Z",
      latestUserMessagePreview: { text: subject },
      planProgress: null,
      ...(question === undefined ? {} : { hasPendingUserInput: true, pendingQuestion: question }),
    },
  });
  yield* drivers.links
    .get(name)!
    .send(yield* encodeLink({ type: "overview", full: true, overview }));
});

export const dropZerops = (drivers: ScenarioDrivers) =>
  Effect.promise(async () => {
    drivers.zerops.handlers.push((request) =>
      request.method === "OPTIONS" ? undefined : drivers.zerops.error(503, "serviceUnavailable"),
    );
    drivers.zerops.faults.set("POST /web-socket/login", { status: 503 });
    const sockets = [...drivers.zerops.sockets.values()];
    if (sockets.length === 0)
      throw new Error("Wait for Zerops realtime before starting its outage");
    await deadline(
      Promise.all(
        sockets.map(
          (socket) =>
            new Promise<void>((resolve) => {
              socket.once("close", resolve);
              socket.close(1011, "scenario outage");
            }),
        ),
      ),
      "Zerops sockets closed",
    );
  });
