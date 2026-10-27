/**
 * crewLayer — crew mode as one layer (ARCHITECTURE §1 *Principle*, §2
 * *Activation*).
 *
 * Two gates, in order: not a Zerops project, or `T3CODE_ZEROPS_CREW` off,
 * builds the inert form (no fibers; the feed says `off`). Otherwise the crew
 * runs on the Mate engine (`engine/CrewEngineLayer.ts`) — and still, with no
 * crew applied, it installs nothing into the thread policy registries, so
 * every thread's adapter options stay byte-identical.
 *
 * @module crewLayer
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";

import { ServerConfig } from "../../config.ts";
import { ClaudeThreadExtensionRegistry } from "../../spi/claudeThreadProfile.ts";
import { ThreadToolPolicyRegistry } from "../../spi/threadToolPolicy.ts";
import { isZeropsEnvironment } from "../ZeropsEnvironment.ts";
import * as CrewApp from "./CrewApp.ts";
import * as CrewChecks from "./CrewChecks.ts";
import { CrewEngine, inertCrewEngine } from "./CrewEngine.ts";
import * as CrewHome from "./CrewHome.ts";
import * as CrewIntegration from "./CrewIntegration.ts";
import * as CrewMemory from "./CrewMemory.ts";
import * as CrewReads from "./CrewReads.ts";
import * as CrewRuntime from "./CrewRuntime.ts";
import { CrewThreadDirectory, CrewToolHost, type CrewToolText } from "./crewSeams.ts";
import * as CrewShell from "./CrewShell.ts";
import * as CrewStore from "./CrewStore.ts";
import { installCrewThreadPolicy } from "./CrewThreadPolicy.ts";
import * as CrewWorkspace from "./CrewWorkspace.ts";
import { crewEngineHooksLayer, engineCrewLayer } from "./engine/CrewEngineLayer.ts";

/**
 * What installs the crew's thread policies for the scope it runs in, given
 * the directory and the tool host (the tools slice's `installCrewThreadPolicy`).
 */
export type CrewPolicyInstaller = Effect.Effect<
  void,
  never,
  | Scope.Scope
  | CrewThreadDirectory
  | CrewToolHost
  | ThreadToolPolicyRegistry
  | ClaudeThreadExtensionRegistry
>;

/** The crew's own services over one store and one shell, so the engine and its parts share them. */
export const crewServicesLayer = Layer.mergeAll(
  CrewWorkspace.layer,
  CrewIntegration.layer,
  CrewApp.layer,
  CrewReads.layer,
  CrewHome.layer,
  CrewRuntime.layer,
  CrewMemory.layer,
).pipe(
  Layer.provideMerge(CrewChecks.layer),
  Layer.provideMerge(CrewShell.layer),
  Layer.provideMerge(CrewStore.layer),
);

/** A crew tool's answer while crew mode is off. */
const notYet = (tool: string): Effect.Effect<CrewToolText> =>
  Effect.succeed({ text: `${tool} is not available to this crew yet.`, isError: true });

/**
 * Crew mode off: the feed says so and every request is refused; no thread is
 * a crewmate's, and no crew tool runs.
 */
export const crewLayerInert = Layer.succeedContext(
  Context.make(CrewEngine, inertCrewEngine).pipe(
    Context.add(CrewThreadDirectory, { memberFor: () => Effect.succeed(Option.none()) }),
    Context.add(CrewToolHost, {
      report: () => notYet("crew_report"),
      board: () => notYet("crew_board"),
      diff: () => notYet("crew_diff"),
      showOnDev: () => notYet("crew_show_on_dev"),
      propose: () => notYet("crew_propose"),
      review: () => notYet("crew_review"),
      finish: () => notYet("crew_finish"),
      memory: () => notYet("crew_memory"),
      sessionStart: () => Effect.succeed(undefined),
      postCompact: () => Effect.void,
    }),
  ),
);

/**
 * Crew mode runs live only inside a Zerops project, with its switch on
 * (ARCHITECTURE §1 gates 1–2), as an owner of the Mate engine
 * (`engine/CrewEngineLayer.ts`).
 */
export const crewModeOn = (config: ServerConfig["Service"]): boolean =>
  isZeropsEnvironment(config) && config.zeropsCrew;

const engineHooks = crewEngineHooksLayer.pipe(Layer.provide(crewServicesLayer));

/**
 * What the Mate engine runs for the crew, in engine crew mode only: its owner kind, the handlers
 * of its effects over the crew's own services, and its crewmates' workspaces.
 */
export const crewEngineHooks = Layer.unwrap(
  Effect.map(ServerConfig, (config): typeof engineHooks =>
    crewModeOn(config) ? engineHooks : (Layer.empty as unknown as typeof engineHooks),
  ),
);

/** The live crew behind gates 1 and 2, with `installer` for the policies. */
export const makeCrewLayer = (installer: CrewPolicyInstaller) => {
  const live = engineCrewLayer(installer).pipe(Layer.provide(crewServicesLayer));
  return Layer.unwrap(
    Effect.map(ServerConfig, (config): typeof live =>
      crewModeOn(config) ? live : (crewLayerInert as unknown as typeof live),
    ),
  );
};

/**
 * Crew mode behind its gates: the thread policy for crew threads
 * (`CrewThreadPolicy`) is installed once a crew is applied, never before.
 */
export const crewLayer = makeCrewLayer(installCrewThreadPolicy);
