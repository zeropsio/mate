import { it } from "@effect/vitest";
import { verifyHqContract } from "../../harness/hqPreflight.ts";

it.effect(
  "Decision: The harness opens the door exactly as the product client does under rev 7 (`/user/info` identity once, no org key) and every HQ verb the harness or a fixture sends carries the calling person's `accessToken` the way the client does; the fake Zerops world answers `/user/info` and the membership/role reads HQ's fresh checks make for each defined person (owner OWNER, dev, reader READ_ONLY), so a scenario that acts as `reader` is refused where the product refuses it.",
  verifyHqContract,
);
