import { cn } from "../../lib/cn";

export type ZeropsStatusTone = "ok" | "busy" | "attention" | "failed" | "off";

const STATUS_DOT_CLASS_NAMES: Readonly<Record<ZeropsStatusTone, string>> = {
  ok: "bg-zerops-status-ok-dot",
  busy: "bg-zerops-status-busy-dot",
  attention: "bg-zerops-status-attention-dot",
  failed: "bg-zerops-status-failed-dot",
  off: "bg-zerops-status-off-dot",
};

const STATUS_LABEL_CLASS_NAMES: Readonly<Record<ZeropsStatusTone, string>> = {
  ok: "text-zerops-status-ok-text",
  busy: "text-[var(--color-zerops-status-busy-text,var(--color-foreground-muted))]",
  attention: "text-zerops-status-attention-text",
  failed: "text-[var(--color-zerops-status-failed-text,var(--color-foreground-muted))]",
  off: "text-foreground-muted",
};

const STATUS_ICON_TINT_CLASS_NAMES: Readonly<Record<ZeropsStatusTone, string>> = {
  ok: "accent-zerops-status-ok-text",
  busy: "accent-[var(--color-zerops-status-busy-text,var(--color-foreground-muted))]",
  attention: "accent-zerops-status-attention-text",
  failed: "accent-[var(--color-zerops-status-failed-text,var(--color-foreground-muted))]",
  off: "accent-foreground-muted",
};

export function statusTonePresentation(tone: ZeropsStatusTone) {
  return {
    labelClassName: STATUS_LABEL_CLASS_NAMES[tone],
    iconTintClassName: STATUS_ICON_TINT_CLASS_NAMES[tone],
  } as const;
}

const STATUS_SURFACE_CLASS_NAMES: Readonly<Record<ZeropsStatusTone, string>> = {
  ok: "bg-zerops-status-ok-surface",
  busy: "bg-zerops-status-busy-surface",
  attention: "bg-zerops-status-attention-surface",
  failed: "bg-zerops-status-failed-surface",
  off: "bg-zerops-status-off-surface",
};

function requirePhrase(component: string, label: string) {
  if (label.trim().length === 0) throw new Error(`${component} requires a phrase`);
  return label;
}

export function statusDotPresentation(props: {
  readonly label: string;
  readonly tone: ZeropsStatusTone;
  readonly state: "steady" | "pulsing";
}) {
  return {
    label: requirePhrase("StatusDot", props.label),
    containerClassName: "flex-row items-center gap-1.5",
    dotClassName: cn("h-2 w-2 rounded-full", STATUS_DOT_CLASS_NAMES[props.tone]),
    labelTone: props.tone,
    motion: {
      active: props.state === "pulsing",
      duration: 1_200,
      frameCount: 3,
      reducedMotionValue: 1,
      minimumOpacity: 0.55,
      opacityRange: 0.45,
    },
  } as const;
}

export function microLabelPresentation(props: {
  readonly label: string;
  readonly tone?: ZeropsStatusTone;
  readonly state?: "default" | "muted";
}) {
  return {
    label: props.label,
    textClassName: cn(
      "text-3xs font-t3-medium uppercase tracking-[0.66px]",
      props.tone === undefined
        ? props.state === "muted"
          ? "text-foreground-muted"
          : "text-foreground"
        : statusTonePresentation(props.tone).labelClassName,
    ),
  } as const;
}

const CHIP_CLASS_NAMES = {
  access: {
    container: "rounded-[10px] bg-zerops-chip-access-surface",
    text: "text-zerops-chip-access-text",
  },
  region: {
    container: "rounded-[10px] bg-zerops-chip-region-surface",
    text: "text-zerops-chip-region-text",
  },
  info: {
    container: "rounded-[8px] bg-zerops-chip-info-surface",
    text: "text-zerops-chip-info-text",
  },
} as const;

export function chipPresentation(props: {
  readonly label: string;
  readonly variant: keyof typeof CHIP_CLASS_NAMES;
  readonly state: "default" | "muted";
}) {
  const variant = CHIP_CLASS_NAMES[props.variant];
  return {
    label: props.label,
    containerClassName: cn(
      "self-start px-2.5 py-1",
      variant.container,
      props.state === "muted" ? "opacity-45" : "opacity-100",
    ),
    textClassName: cn("text-[10px] font-t3-medium uppercase", variant.text),
  } as const;
}

export function pillPresentation(props: {
  readonly label: string;
  readonly variant: "primary" | "secondary";
  readonly state: "enabled" | "disabled";
}) {
  const disabled = props.state === "disabled";
  return {
    label: props.label,
    disabled,
    containerClassName: cn(
      "min-h-10 flex-row items-center justify-center rounded-full px-5 py-2.5 active:opacity-70",
      props.variant === "primary" ? "bg-primary" : "border border-secondary-border bg-secondary",
      disabled ? "opacity-45" : "opacity-100",
    ),
    textClassName: cn(
      "text-sm font-t3-medium",
      props.variant === "primary" ? "text-primary-foreground" : "text-secondary-foreground",
    ),
  } as const;
}

export function flatCardPresentation(props: {
  readonly tone?: ZeropsStatusTone;
  readonly state: "default" | "emphasized";
}) {
  return {
    containerClassName: cn(
      "rounded-[10px] border p-4",
      props.tone === undefined ? "bg-card" : STATUS_SURFACE_CLASS_NAMES[props.tone],
      props.state === "emphasized" ? "border-primary" : "border-zerops-flat-card-border",
    ),
  } as const;
}

export function keyChipPresentation(props: {
  readonly label: string;
  readonly variant: "default" | "accent";
  readonly state: "default" | "pressed";
}) {
  return {
    label: props.label,
    containerClassName: cn(
      "rounded-[3px] border px-1.5 py-0.5",
      props.variant === "accent" ? "border-primary bg-primary" : "border-border bg-subtle",
      props.state === "pressed" ? "opacity-70" : "opacity-100",
    ),
    textClassName: cn(
      "text-3xs font-t3-medium",
      props.variant === "accent" ? "text-primary-foreground" : "text-foreground",
    ),
  } as const;
}

const LIVENESS_PRESENTATIONS = {
  live: { label: "Live", tone: "ok", icon: "checkmark.circle" },
  polling: { label: "Polling", tone: "busy", icon: "arrow.clockwise" },
  "doorbell-down": { label: "Doorbell down", tone: "off", icon: "wifi.slash" },
  "last-read-failed": {
    label: "Last read failed",
    tone: "attention",
    icon: "exclamationmark.triangle",
  },
} as const;

export type LivenessLineState = keyof typeof LIVENESS_PRESENTATIONS | "absent";

export function livenessLinePresentation(props: {
  readonly state: LivenessLineState;
  readonly label?: string;
}) {
  if (props.state === "absent") {
    return { visible: false } as const;
  }

  const state = LIVENESS_PRESENTATIONS[props.state];
  const tone = statusTonePresentation(state.tone);
  return {
    visible: true,
    label: props.label ?? state.label,
    tone: state.tone,
    icon: state.icon,
    iconSize: 12,
    iconType: "monochrome",
    containerClassName: "flex-row items-center gap-1.5",
    textClassName: cn("text-3xs font-t3-medium", tone.labelClassName),
    iconTintClassName: tone.iconTintClassName,
  } as const;
}
