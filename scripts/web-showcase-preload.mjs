import * as NodeProcess from "node:process";

export const APPEARANCE_ARGUMENT = "--web-showcase-appearance=";

export function matchesRequestedAppearance(state, requestedAppearance) {
  return (
    state.appearance === requestedAppearance &&
    state.followSystem === "false" &&
    state.resolvedAppearance === requestedAppearance
  );
}

const argument = NodeProcess.argv.find((value) => value.startsWith(APPEARANCE_ARGUMENT));
if (argument !== undefined) {
  const appearance = argument.slice(APPEARANCE_ARGUMENT.length);
  if (appearance !== "light" && appearance !== "dark") {
    throw new Error("The web showcase preload received no valid appearance.");
  }
  globalThis.localStorage.setItem("t3code:theme-appearance-mode", appearance);
  globalThis.localStorage.setItem("t3code:theme-follow-system", "false");
}
