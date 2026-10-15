import { InfoIcon, Undo2Icon } from "lucide-react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import {
  createContext,
  type ComponentPropsWithoutRef,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { cn } from "../../lib/utils";
import { WorkspacePageContainer, type WorkspacePageWidth } from "../WorkspacePageContainer";
import { Button } from "../ui/button";
import { Row } from "../ui/row";
import { SectionHeader } from "../ui/section";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

interface SettingsSearchTargetContextValue {
  readonly targetId: string | null;
  readonly onTargetHandled: () => void;
}

const noop = () => undefined;
const SettingsSearchTargetContext = createContext<SettingsSearchTargetContextValue>({
  targetId: null,
  onTargetHandled: noop,
});

function SettingsSearchTargetProvider({
  targetId,
  onTargetHandled = noop,
  children,
}: {
  targetId: string | null;
  onTargetHandled?: () => void;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ targetId, onTargetHandled }), [onTargetHandled, targetId]);
  return <SettingsSearchTargetContext value={value}>{children}</SettingsSearchTargetContext>;
}

function scrollAndFocusSettingsTarget(target: HTMLElement): void {
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const scrollTarget =
    target.tagName === "SECTION" && target.firstElementChild
      ? (target.firstElementChild as HTMLElement)
      : target;

  scrollTarget.scrollIntoView({
    behavior: prefersReducedMotion ? "auto" : "smooth",
    block: "center",
  });
  target.focus({ preventScroll: true });
  target.classList.remove("settings-search-target-pulse");
  if (prefersReducedMotion) return;
  void target.offsetWidth;
  target.classList.add("settings-search-target-pulse");
  // The class also suppresses the focus outline (the pulse is the destination
  // indicator), so drop it once the element is no longer the destination.
  target.addEventListener("blur", () => target.classList.remove("settings-search-target-pulse"), {
    once: true,
  });
}

/** The row id a settings-search jump is currently trying to reach, if any. */
export function useSettingsSearchTargetId(): string | null {
  return useContext(SettingsSearchTargetContext).targetId;
}

function useSettingsSearchTarget<T extends HTMLElement>(id: string | undefined) {
  const { targetId, onTargetHandled } = useContext(SettingsSearchTargetContext);
  const isSearchTarget = id !== undefined && id === targetId;
  const targetRef = useCallback(
    (target: T | null) => {
      if (target && isSearchTarget) {
        scrollAndFocusSettingsTarget(target);
        onTargetHandled();
      }
    },
    [isSearchTarget, onTargetHandled],
  );

  return targetRef;
}

/** Info affordance explaining how a setting interacts with the shared background policy. */
export function PolicyTooltip({ children }: { readonly children: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        delay={200}
        render={
          <Button size="icon-sm" variant="ghost" aria-label="Background policy details">
            <InfoIcon className="size-3.5" />
          </Button>
        }
      />
      <TooltipPopup side="top">{children}</TooltipPopup>
    </Tooltip>
  );
}

/** Re-render every `intervalMs`; return a stable timestamp snapshot for render-time relative labels. */
export function useRelativeTimeTick(intervalMs = 1_000) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return nowMs;
}

export function SettingsSection({
  title,
  icon,
  count,
  headerAction,
  children,
  className,
  ...sectionProps
}: ComponentPropsWithoutRef<"section"> & {
  title: string;
  icon?: ReactNode;
  /** How many it holds, beside its title. */
  count?: ReactNode;
  headerAction?: ReactNode;
  children: ReactNode;
}) {
  const targetRef = useSettingsSearchTarget<HTMLElement>(sectionProps.id);

  return (
    <section
      {...sectionProps}
      ref={targetRef}
      tabIndex={sectionProps.id ? -1 : sectionProps.tabIndex}
      className={cn("flex flex-col gap-2", className)}
    >
      <div className="px-3">
        <SectionHeader
          action={headerAction}
          count={count}
          title={
            <>
              {icon}
              {title}
            </>
          }
        />
      </div>
      <div className="relative space-y-1 overflow-visible text-foreground">{children}</div>
    </section>
  );
}

export function SettingsRow({
  title,
  description,
  status,
  resetAction,
  control,
  children,
  className,
  ...rowProps
}: Omit<ComponentPropsWithoutRef<"div">, "title"> & {
  title: ReactNode;
  description?: ReactNode;
  status?: ReactNode;
  resetAction?: ReactNode;
  control?: ReactNode;
  children?: ReactNode;
}) {
  const targetRef = useSettingsSearchTarget<HTMLDivElement>(rowProps.id);
  const lined = Boolean(description) || Boolean(status);

  return (
    <div
      {...rowProps}
      ref={targetRef}
      tabIndex={rowProps.id ? -1 : rowProps.tabIndex}
      className={cn("rounded-xl", children ? "pb-1" : undefined, className)}
    >
      <Row
        control={
          resetAction || control ? (
            <>
              {/* Before the control, in the room it has: its line's height, so showing it never
                  grows the row. */}
              {resetAction ? <span className="-my-1 flex">{resetAction}</span> : null}
              {control}
            </>
          ) : undefined
        }
        line={
          lined ? (
            <>
              {description}
              {status ? <span className="block pt-0.5 text-muted-foreground">{status}</span> : null}
            </>
          ) : undefined
        }
        lineWraps
        size="sm"
        title={title}
      />
      {children}
    </div>
  );
}

export function SettingResetButton({
  label,
  disabled = false,
  onClick,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={`Reset ${label} to default`}
            disabled={disabled}
            onClick={(event) => {
              event.stopPropagation();
              onClick();
            }}
          >
            <Undo2Icon className="size-3" />
          </Button>
        }
      />
      <TooltipPopup side="top">Reset to default</TooltipPopup>
    </Tooltip>
  );
}

/**
 * Trigger classes for the composer model/traits pickers when they sit in a
 * settings row: drop the composer's max-width so the trigger sizes to its
 * label instead.
 */
export const SETTINGS_PICKER_TRIGGER_CLASSNAME =
  "min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground";

export function SettingsPageContainer({
  children,
  className,
  width = "readable",
}: {
  children: ReactNode;
  className?: string;
  width?: WorkspacePageWidth;
}) {
  const navigate = useNavigate();
  const hash = useLocation({ select: (location) => location.hash });
  const targetId = hash.replace(/^#/, "") || null;
  const clearTargetHash = useCallback(() => {
    void navigate({ hash: "", replace: true, resetScroll: false, hashScrollIntoView: false });
  }, [navigate]);

  return (
    <SettingsSearchTargetProvider targetId={targetId} onTargetHandled={clearTargetHash}>
      <div
        className="topbar-scroll-fade scrollbar-gutter-both flex-1 overflow-y-auto [--topbar-scroll-fade-height:1.5rem] sm:[--topbar-scroll-fade-height:1.5rem]"
        data-settings-page-scroll
      >
        <WorkspacePageContainer width={width} className={cn("gap-12", className)}>
          {children}
        </WorkspacePageContainer>
      </div>
    </SettingsSearchTargetProvider>
  );
}

export function scrollToSettingsTarget(targetId: string): boolean {
  const target = document.getElementById(targetId);
  if (!target) return false;
  scrollAndFocusSettingsTarget(target);
  return true;
}
