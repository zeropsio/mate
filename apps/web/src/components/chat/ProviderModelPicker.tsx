import {
  ANTIGRAVITY_DEFAULT_MODEL,
  type ProviderInstanceId,
  type ProviderDriverKind,
  type ResolvedKeybindingsConfig,
} from "@t3tools/contracts";
import { ZapIcon } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Badge } from "../ui/badge";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { cn } from "~/lib/utils";
import {
  ModelPickerContent,
  resolveModelPickerSelectedModel,
  type ModelPickerRenderInstancePanel,
} from "./ModelPickerContent";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon";
import {
  ModelEsque,
  getTriggerDisplayModelLabel,
  getTriggerDisplayModelName,
} from "./providerIconUtils";
import { shouldShowInstanceBadge, type ProviderInstanceEntry } from "../../providerInstances";
import { ComposerControl, ComposerControlChevron } from "./ComposerControl";
import {
  composerModelControlLabel,
  composerModelControlText,
  type ComposerModelControlLabel,
} from "./ComposerModelControl.logic";
import { shortcutLabelForCommand } from "../../keybindings";
import {
  composerControlKey,
  rememberComposerControl,
  rememberedComposerControl,
  shownComposerControl,
  type ComposerControlLook,
} from "./composerControlMemory";

/**
 * The composer's one quiet control (C4): the trigger says the model and its
 * effort, "Sonnet 5 · High", and the menu holds `choices` — the effort, the
 * model's other choices and the access — beside the models.
 */
export interface ProviderModelPickerComposer {
  /** The model's options as chosen now, and whether the prompt sets the effort. */
  readonly traits: Pick<
    Parameters<typeof composerModelControlLabel>[0],
    "descriptors" | "ultrathinkPromptControlled"
  >;
  readonly choices: ReactNode;
  /** The composer shortcuts that open it (`composer.effort`, and `composer.mode` while access has no control of its own). */
  readonly shortcuts: string;
}

export const ProviderModelPicker = memo(function ProviderModelPicker(props: {
  /**
   * The instance currently selected in the composer. Drives the trigger
   * icon, label and the default-highlighted combobox row.
   */
  activeInstanceId: ProviderInstanceId;
  model: string;
  lockedProvider: ProviderDriverKind | null;
  lockedContinuationGroupKey?: string | null;
  /** Instance entries rendered in the sidebar + used to resolve display name. */
  instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  keybindings?: ResolvedKeybindingsConfig;
  modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>>;
  activeProviderIconClassName?: string;
  /** The composer's one control: its label and menu (see `ProviderModelPickerComposer`). */
  composer?: ProviderModelPickerComposer;
  disabled?: boolean;
  /**
   * The agents' catalog is still read: the composer's control stands as it last looked for this
   * model (`composerControlMemory`) rather than as the raw selection.
   */
  catalogPending?: boolean;
  /** Also remembers the control's look under this key: its conversation's own, preferred while the catalog is read. */
  rememberAs?: string | undefined;
  terminalOpen?: boolean;
  open?: boolean;
  triggerClassName?: string;
  triggerAriaLabel?: string;
  /**
   * Replaces the trigger's visible text (e.g. "Sign in an agent" when
   * nothing is selected because no agent is runnable, D6) without touching
   * the icon or badge, which already render nothing for an unmatched
   * `activeInstanceId`.
   */
  triggerLabelOverride?: string;
  onOpenChange?: (open: boolean) => void;
  onOpenProviderSetup?: (instanceId: ProviderInstanceId) => void;
  getModelDisabledReason?: (instanceId: ProviderInstanceId, model: string) => string | null;
  /** See `ModelPickerContent`'s `renderInstancePanel` — passed straight through. */
  renderInstancePanel?: ModelPickerRenderInstancePanel;
  onInstanceModelChange: (instanceId: ProviderInstanceId, model: string) => void;
}) {
  const [uncontrolledIsMenuOpen, setUncontrolledIsMenuOpen] = useState(false);
  const isMenuOpen = props.open ?? uncontrolledIsMenuOpen;
  const menuRef = useRef<HTMLDivElement>(null);

  // Resolve the active instance entry by exact routing key. The composer
  // resolves fallbacks before rendering this component; if the selected
  // instance disappears, do not infer a replacement from its driver kind.
  const activeEntry = useMemo(() => {
    return (
      props.instanceEntries.find((entry) => entry.instanceId === props.activeInstanceId) ?? null
    );
  }, [props.activeInstanceId, props.instanceEntries]);

  const activeInstanceId = props.activeInstanceId;
  const selectedInstanceOptions = props.modelOptionsByInstance.get(activeInstanceId) ?? [];
  // Account-specific catalogs must keep the selected model label while unavailable.
  const selectedModel =
    resolveModelPickerSelectedModel({
      driverKind: activeEntry?.driverKind,
      model: props.model,
      options: selectedInstanceOptions,
    }) ??
    (activeEntry?.driverKind === "opencode" || activeEntry?.driverKind === "antigravity"
      ? undefined
      : selectedInstanceOptions[0]);
  const triggerTitle =
    props.triggerLabelOverride ??
    (selectedModel
      ? getTriggerDisplayModelName(selectedModel)
      : props.model === ANTIGRAVITY_DEFAULT_MODEL
        ? "Choose model"
        : props.model || "Choose model");
  const triggerLabel =
    props.triggerLabelOverride ??
    (selectedModel
      ? `${getTriggerDisplayModelLabel(selectedModel)}${selectedModel.isUnavailable ? " (Unavailable)" : ""}`
      : triggerTitle);
  const showInstanceBadge =
    activeEntry !== null && shouldShowInstanceBadge(activeEntry, props.instanceEntries);
  const composerLabel: ComposerModelControlLabel | null =
    props.composer === undefined || activeEntry === null
      ? null
      : props.triggerLabelOverride !== undefined || selectedModel === undefined
        ? { model: triggerTitle, traits: [], fast: false }
        : composerModelControlLabel({
            provider: activeEntry.driverKind,
            modelName: triggerTitle,
            ...props.composer.traits,
          });

  // The composer's control as it stands now, remembered for the next time the catalog is read.
  const controlKey = composerControlKey(activeInstanceId, props.model);
  const resolvedLook: ComposerControlLook | null =
    props.composer !== undefined &&
    activeEntry !== null &&
    composerLabel !== null &&
    selectedModel !== undefined &&
    props.triggerLabelOverride === undefined
      ? {
          driverKind: activeEntry.driverKind,
          displayName: activeEntry.displayName,
          accentColor: activeEntry.accentColor,
          label: composerLabel,
        }
      : null;
  const resolvedLookText = resolvedLook === null ? null : JSON.stringify(resolvedLook);
  const rememberAs = props.rememberAs;
  useEffect(() => {
    if (resolvedLookText === null) return;
    const resolved = JSON.parse(resolvedLookText) as ComposerControlLook;
    rememberComposerControl(controlKey, resolved);
    if (rememberAs !== undefined) rememberComposerControl(rememberAs, resolved);
  }, [controlKey, rememberAs, resolvedLookText]);
  const look = shownComposerControl({
    resolved: resolvedLook,
    pending: props.catalogPending === true,
    remembered: [
      rememberAs === undefined ? undefined : rememberedComposerControl(rememberAs),
      rememberedComposerControl(controlKey),
    ],
  });

  const setIsMenuOpen = (open: boolean) => {
    props.onOpenChange?.(open);
    if (props.open === undefined) {
      setUncontrolledIsMenuOpen(open);
    }
  };

  useEffect(() => {
    if (!isMenuOpen) {
      return;
    }

    const { documentElement, body } = document;
    const previousDocumentOverscrollBehavior = documentElement.style.overscrollBehavior;
    const previousBodyOverflow = body.style.overflow;
    const previousBodyPaddingRight = body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - documentElement.clientWidth;

    documentElement.style.overscrollBehavior = "contain";
    body.style.overflow = "hidden";
    if (scrollbarWidth > 0) {
      body.style.paddingRight = `${scrollbarWidth}px`;
    }

    // The wheel and a touch drag scroll what the open menu holds — its model
    // list and, in the composer, the choices beside it — and nothing behind it.
    const shouldAllowOverlayScroll = (target: EventTarget | null) => {
      return target instanceof Node && menuRef.current?.contains(target) === true;
    };
    const preventBackgroundWheel = (event: WheelEvent) => {
      if (shouldAllowOverlayScroll(event.target)) {
        return;
      }
      event.preventDefault();
    };
    const preventBackgroundTouchMove = (event: TouchEvent) => {
      if (shouldAllowOverlayScroll(event.target)) {
        return;
      }
      event.preventDefault();
    };

    document.addEventListener("wheel", preventBackgroundWheel, { capture: true, passive: false });
    document.addEventListener("touchmove", preventBackgroundTouchMove, {
      capture: true,
      passive: false,
    });

    return () => {
      document.removeEventListener("wheel", preventBackgroundWheel, { capture: true });
      document.removeEventListener("touchmove", preventBackgroundTouchMove, { capture: true });
      documentElement.style.overscrollBehavior = previousDocumentOverscrollBehavior;
      body.style.overflow = previousBodyOverflow;
      body.style.paddingRight = previousBodyPaddingRight;
    };
  }, [isMenuOpen]);

  const handleInstanceModelChange = (instanceId: ProviderInstanceId, model: string) => {
    if (props.disabled) return;
    props.onInstanceModelChange(instanceId, model);
    setIsMenuOpen(false);
  };

  const shortcutLabel = props.keybindings
    ? shortcutLabelForCommand(props.keybindings, "modelPicker.toggle")
    : null;
  const triggerTooltipContent = shortcutLabel ? `${triggerLabel} · ${shortcutLabel}` : triggerLabel;

  const content = (
    <ModelPickerContent
      activeInstanceId={activeInstanceId}
      model={props.model}
      lockedProvider={props.lockedProvider}
      lockedContinuationGroupKey={props.lockedContinuationGroupKey ?? null}
      instanceEntries={props.instanceEntries}
      {...(props.keybindings ? { keybindings: props.keybindings } : {})}
      modelOptionsByInstance={props.modelOptionsByInstance}
      terminalOpen={props.terminalOpen ?? false}
      onRequestClose={() => setIsMenuOpen(false)}
      {...(props.onOpenProviderSetup ? { onOpenProviderSetup: props.onOpenProviderSetup } : {})}
      {...(props.getModelDisabledReason
        ? { getModelDisabledReason: props.getModelDisabledReason }
        : {})}
      {...(props.renderInstancePanel ? { renderInstancePanel: props.renderInstancePanel } : {})}
      onInstanceModelChange={handleInstanceModelChange}
    />
  );

  if (props.composer !== undefined) {
    const shownLabel = look?.label ?? composerLabel;
    const text = shownLabel === null ? triggerLabel : composerModelControlText(shownLabel);
    return (
      <Popover
        open={isMenuOpen}
        onOpenChange={(open) => {
          if (props.disabled) {
            setIsMenuOpen(false);
            return;
          }
          setIsMenuOpen(open);
        }}
      >
        <PopoverTrigger
          render={
            <ComposerControl
              aria-label={props.triggerAriaLabel ?? text}
              className={cn("min-w-0 shrink", props.triggerClassName)}
              data-chat-provider-model-picker="true"
              data-composer-shortcut={props.composer.shortcuts}
              // A catalog still read is a beat, not a refusal: the control keeps its look,
              // and the popover above stays shut until it is read.
              disabled={props.disabled === true && props.catalogPending !== true}
              aria-disabled={props.catalogPending === true || undefined}
              size="quiet"
            />
          }
        >
          {look !== null ? (
            <ProviderInstanceIcon
              driverKind={look.driverKind}
              displayName={look.displayName}
              accentColor={look.accentColor}
              showBadge={look === resolvedLook && showInstanceBadge}
              className="size-3.5"
              iconClassName={cn("size-3.5", props.activeProviderIconClassName)}
              indicatorBackground="var(--contrast-input)"
            />
          ) : activeEntry ? (
            <ProviderInstanceIcon
              driverKind={activeEntry.driverKind}
              displayName={activeEntry.displayName}
              accentColor={activeEntry.accentColor}
              showBadge={showInstanceBadge}
              className="size-3.5"
              iconClassName={cn("size-3.5", props.activeProviderIconClassName)}
              indicatorBackground="var(--contrast-input)"
            />
          ) : null}
          <Tooltip>
            <TooltipTrigger render={<span className="min-w-0 truncate" />}>
              {shownLabel === null ? triggerTitle : shownLabel.model}
            </TooltipTrigger>
            <TooltipPopup side="top">{triggerTooltipContent}</TooltipPopup>
          </Tooltip>
          {shownLabel === null || shownLabel.traits.length === 0 ? null : (
            <span className="shrink-0 whitespace-nowrap">
              {`· ${shownLabel.traits.join(" · ")}`}
            </span>
          )}
          {shownLabel?.fast ? (
            <ZapIcon aria-label="Fast mode on" className="size-3.5 shrink-0 fill-current" />
          ) : null}
          {selectedModel?.isUnavailable ? (
            <Badge variant="outline" size="sm">
              Unavailable
            </Badge>
          ) : null}
          <ComposerControlChevron size="quiet" />
        </PopoverTrigger>
        <PopoverPopup align="start" className="before:hidden" padding="none" ref={menuRef}>
          <div className="composer-model-menu">
            {content}
            {props.composer.choices}
          </div>
        </PopoverPopup>
      </Popover>
    );
  }

  return (
    <Popover
      open={isMenuOpen}
      onOpenChange={(open) => {
        if (props.disabled) {
          setIsMenuOpen(false);
          return;
        }
        setIsMenuOpen(open);
      }}
    >
      <PopoverTrigger
        render={
          <ComposerControl
            aria-label={props.triggerAriaLabel}
            data-chat-provider-model-picker="true"
            className={cn(
              "min-w-0 max-w-48 shrink justify-between whitespace-nowrap sm:max-w-56",
              props.triggerClassName,
            )}
            disabled={props.disabled}
          />
        }
      >
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          {activeEntry ? (
            <ProviderInstanceIcon
              driverKind={activeEntry.driverKind}
              displayName={activeEntry.displayName}
              accentColor={activeEntry.accentColor}
              showBadge={showInstanceBadge}
              className="size-4"
              iconClassName={cn("size-4", props.activeProviderIconClassName)}
              indicatorBackground="var(--contrast-input)"
              badgeClassName={cn(
                "right-[-0.125rem] bottom-[-0.125rem] h-3 min-w-3",
                "px-0.5 text-3xs",
              )}
            />
          ) : null}
          <Tooltip>
            <TooltipTrigger render={<span className="min-w-0 flex-1 overflow-hidden truncate" />}>
              {triggerTitle}
            </TooltipTrigger>
            <TooltipPopup side="top">{triggerTooltipContent}</TooltipPopup>
          </Tooltip>
          {selectedModel?.isUnavailable ? (
            <Badge variant="outline" size="sm">
              Unavailable
            </Badge>
          ) : null}
        </span>
        <span aria-hidden="true" className="flex items-center">
          <ComposerControlChevron />
        </span>
      </PopoverTrigger>
      <PopoverPopup align="start" className="before:hidden" padding="none" ref={menuRef}>
        {content}
      </PopoverPopup>
    </Popover>
  );
});
