import { buildScenarioBundle } from "./build.ts";

let deviceLoginBundle: Promise<string> | undefined;

/**
 * The build that signs in by device login, made the first time a file asks for it: only its
 * scenarios pay for it. Ask in the file's `beforeAll`, where a cold build fits the hook's time, and
 * hand the result to `createScenario` as its `dist`. Kept apart from the harness, so a test that
 * imports the harness never depends on the bundle build.
 */
export function deviceLoginDist() {
  return (deviceLoginBundle ??= buildScenarioBundle("device-login"));
}
