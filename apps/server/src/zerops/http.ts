import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { HttpRouter, HttpServerResponse } from "effect/http";
import * as ServerConfig from "../config.ts";
import { isZeropsEnvironment } from "./ZeropsEnvironment.ts";
import { ZeropsSetup } from "./ZeropsSetup.ts";

/**
 * `GET /setup.json` (`/mate/setup.json` behind the container's nginx): a new
 * Mate's setup, step by step (`ZeropsSetup`). Public and readable from any
 * origin — it carries no names, no error text and no secrets — so any
 * browser, signed in or not, can show how far the Mate has come. A server
 * outside a Zerops project answers 404, as an older Mate does.
 */
export const zeropsSetupRouteLayer = HttpRouter.add(
  "GET",
  "/setup.json",
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const setup = yield* Effect.serviceOption(ZeropsSetup);
    if (Option.isNone(setup) || !isZeropsEnvironment(config)) {
      return HttpServerResponse.text("Not Found", { status: 404 });
    }
    return HttpServerResponse.jsonUnsafe(yield* setup.value.document, {
      headers: { "access-control-allow-origin": "*", "cache-control": "no-store" },
    });
  }),
);
