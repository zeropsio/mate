/**
 * The Mate engine's direction rule and its run-admission door, read by the `engine-boundary`,
 * `run-admission-door` and `crew-boundary` lint rules. Data only.
 *
 * The engine lives in `apps/server/src/engine/**` and reaches outside only to its neutral seams,
 * named in `ENGINE_ALLOWED_OUTSIDE` and `ENGINE_ALLOWED_OUTSIDE_DIRS`: the content assets, the
 * update fence and drains, the attachment store, the config, the provider service, the terminal
 * manager, the transport's stream window, the migrations' newer-state guard and the SPI. It never
 * reaches `orchestration/**` or `zerops/**` except the pairs in `ENGINE_BOUNDARY_EXCEPTIONS`, which
 * may only shrink: an exception is removed, never added, without a maintainer's word. Zerops
 * reaches the engine through `ports.ts`, and a neutral seam may itself import zerops modules.
 * Outside the engine, only the wiring files reach in, and only to its public surface (the service,
 * the layer, the ports and the wire's RPC registration); the crew's owner kind also reaches the
 * engine's owner seams. Tests and `testing/` harnesses may reach further.
 *
 * Every engine run is admitted once: the engine asks its `RunAdmission` port in one module, and
 * `ZeropsTurnAdmission.admitRun` is called only by the files in `ADMIT_RUN_CALLERS`.
 */

export const ENGINE_DIR = "apps/server/src/engine";

/** The update module's seams both the engine and the crew may reach. */
export const UPDATE_NEUTRAL_SEAMS = [
  "apps/server/src/update/AdmissionFence.ts",
  "apps/server/src/update/MateUpdateDrain.ts",
  "apps/server/src/update/NativeResume.ts",
  "apps/server/src/update/OwnedWork.ts",
  "apps/server/src/update/subscribeChanges.ts",
] as const;

export const ENGINE_PUBLIC_FILES: ReadonlySet<string> = new Set([
  "apps/server/src/engine/MateEngine.ts",
  "apps/server/src/engine/layer.ts",
  "apps/server/src/engine/ports.ts",
  "apps/server/src/engine/registerEngineRpc.ts",
]);

/** The wiring files and graft layers that reach the engine's public surface. */
export const ENGINE_WIRING_FILES: ReadonlySet<string> = new Set([
  "apps/server/src/engineSessionDirectory.ts",
  "apps/server/src/zerops/mateUpdateDrainLive.ts",
  "apps/server/src/zerops/ZeropsMateUpdate.ts",
  "apps/server/src/serverRuntimeStartup.ts",
  "apps/server/src/ws.ts",
  "apps/server/src/zerops/ThreadFileWrites.ts",
  "apps/server/src/zerops/ZeropsFixtureFeeds.ts",
  "apps/server/src/zerops/ZeropsHqLink.ts",
  "apps/server/src/zerops/ZeropsMateAttention.ts",
  "apps/server/src/zerops/ZeropsMateMessages.ts",
  "apps/server/src/zerops/ZeropsSetup.ts",
  "apps/server/src/zerops/ZeropsSignOut.ts",
  "apps/server/src/zerops/ZeropsStandUpRelay.ts",
  "apps/server/src/zerops/ZeropsTasks.ts",
  "apps/server/src/zerops/engineAdapters.ts",
  "apps/server/src/zerops/engineOverview.ts",
  "apps/server/src/zerops/zeropsFeedsLayer.ts",
]);

/** The engine's neutral seams outside its directory. */
export const ENGINE_ALLOWED_OUTSIDE: ReadonlySet<string> = new Set([
  // The Mate's content-addressed picture store, and the one keep of a tool result's inline
  // picture V1's capture, the history import and a live call share.
  "apps/server/src/assets/ContentAssets.ts",
  "apps/server/src/assets/ConversationMedia.ts",
  ...UPDATE_NEUTRAL_SEAMS,
  "apps/server/src/attachmentStore.ts",
  "apps/server/src/config.ts",
  "apps/server/src/provider/Services/ProviderService.ts",
  // The transport's stream window: no domain in it; `ws.ts` and the terminal's protocol use it alike.
  "apps/server/src/RpcStreamWindow.ts",
  // The guard every migration chain calls.
  "apps/server/src/persistence/NewerState.ts",
  "apps/server/src/terminal/Manager.ts",
]);
export const ENGINE_ALLOWED_OUTSIDE_DIRS: ReadonlyArray<string> = ["apps/server/src/spi/"];

const ACTIVITY_PAYLOAD_PROJECTION = "apps/server/src/orchestration/ActivityPayloadProjection.ts";
const ZEROPS_ACTIVITY_RESULT = "apps/server/src/zerops/zeropsActivityResult.ts";
const ACTIVITY_PAYLOAD_REASON =
  "V1's own projection of a tool activity: an engine call (live or imported) carries what V1's row of it shows by construction";
const ACTIVITY_RESULT_REASON = "the Zerops tool result an engine call decodes";

export interface EngineBoundaryException {
  /** The importing file, repo-relative. */
  readonly file: string;
  /** The imported file, repo-relative. */
  readonly target: string;
  readonly reason: string;
}

/** The engine's imports of V1 or Zerops that break the rule today; only shrinks. */
export const ENGINE_BOUNDARY_EXCEPTIONS: ReadonlyArray<EngineBoundaryException> = [
  {
    file: "apps/server/src/engine/bridge/callFacts.ts",
    target: ACTIVITY_PAYLOAD_PROJECTION,
    reason: ACTIVITY_PAYLOAD_REASON,
  },
  {
    file: "apps/server/src/engine/history/pictures.ts",
    target: ACTIVITY_PAYLOAD_PROJECTION,
    reason: ACTIVITY_PAYLOAD_REASON,
  },
  {
    file: "apps/server/src/engine/history/v1.ts",
    target: ACTIVITY_PAYLOAD_PROJECTION,
    reason: ACTIVITY_PAYLOAD_REASON,
  },
  {
    file: "apps/server/src/engine/bridge/callFacts.ts",
    target: ZEROPS_ACTIVITY_RESULT,
    reason: ACTIVITY_RESULT_REASON,
  },
  {
    file: "apps/server/src/engine/pump/toCore.ts",
    target: ZEROPS_ACTIVITY_RESULT,
    reason: ACTIVITY_RESULT_REASON,
  },
];

// The crew on the engine is an owner kind of the engine (CREW-DESIGN §5): `zerops/crew/engine/**`
// reaches the engine's owner seams — the owner registry and its doors, the effect outbox and
// worker its effects run in, the command, the turn pump's directory — besides its public surface.
// The rest of crew never reaches the engine.
export const ENGINE_OWNER_KIND_DIR = "apps/server/src/zerops/crew/engine/";
export const ENGINE_OWNER_SEAMS: ReadonlySet<string> = new Set([
  "apps/server/src/engine/ConversationActor.ts",
  "apps/server/src/engine/Conversations.ts",
  "apps/server/src/engine/domain/command.ts",
  "apps/server/src/engine/effects/index.ts",
  "apps/server/src/engine/outbox/EffectOutbox.ts",
  "apps/server/src/engine/outbox/EffectWorker.ts",
  "apps/server/src/engine/owners.ts",
  "apps/server/src/engine/pump/TurnPump.ts",
]);
export const isEngineOwnerSeam = (file: string, target: string): boolean =>
  file.startsWith(ENGINE_OWNER_KIND_DIR) &&
  (ENGINE_OWNER_SEAMS.has(target) || ENGINE_PUBLIC_FILES.has(target));

/** Whether a repo-relative import from `file` to `target` keeps the engine's direction rule. */
export const engineImportAllowed = (file: string, target: string): boolean => {
  const insideEngine = file.startsWith(`${ENGINE_DIR}/`);
  const targetInEngine = target.startsWith(`${ENGINE_DIR}/`);
  if (insideEngine) {
    return (
      targetInEngine ||
      ENGINE_ALLOWED_OUTSIDE.has(target) ||
      ENGINE_ALLOWED_OUTSIDE_DIRS.some((dir) => target.startsWith(dir)) ||
      ENGINE_BOUNDARY_EXCEPTIONS.some(
        (exception) => exception.file === file && exception.target === target,
      )
    );
  }
  return (
    !targetInEngine ||
    (ENGINE_WIRING_FILES.has(file) && ENGINE_PUBLIC_FILES.has(target)) ||
    isEngineOwnerSeam(file, target)
  );
};

/** The callers of `ZeropsTurnAdmission.admitRun`, D6's run door, each with why it calls it. */
export const ADMIT_RUN_CALLERS: Readonly<Record<string, string>> = {
  "apps/server/src/zerops/engineAdapters.ts":
    "the engine's RunAdmission port's adapter: every engine run is admitted through it",
  "apps/server/src/zerops/ZeropsMateMessages.ts":
    "asks the run's own verdict before it opens the run, so a Mate's message waits instead of opening a run that is refused; it starts no run there, and has no RunTrigger for the port",
};

/** The engine module that asks the `RunAdmission` port: the run's workspace capture. */
export const ENGINE_RUN_ADMISSION_SITE = "apps/server/src/engine/effects/admission.ts";
/** The port's definition, which names `RunAdmission` without asking it. */
export const ENGINE_PORTS_FILE = "apps/server/src/engine/ports.ts";
