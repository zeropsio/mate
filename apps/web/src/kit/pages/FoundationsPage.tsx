import {
  IDENTITY,
  MOTION,
  RADII,
  SERVICE_STATUS_TONES,
  SPACING_UNIT,
  TYPE_SCALE,
} from "@t3tools/shared/brand";
import {
  getThemeColorsForAppearance,
  THEME_COLOR_ROLES,
  ZEROPS_THEME,
  type ThemeColorRole,
  WEB_THEME_ROLE_TOKENS,
} from "@t3tools/shared/themePalettes";
import { PlayIcon } from "lucide-react";
import { useState } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Section } from "~/components/ui/section";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";

import type { FoundationId } from "../shell/kitPages";
import { KitDocument } from "./KitDocument";

const LIGHT = getThemeColorsForAppearance(ZEROPS_THEME, "light");
const DARK = getThemeColorsForAppearance(ZEROPS_THEME, "dark");

/** The theme's roles by what they paint, in the order a surface is built: ground, ink, lines. */
function roleFamily(role: ThemeColorRole): string {
  if (role.startsWith("sidebar")) return "Menu";
  if (role.startsWith("toolbar")) return "Toolbar";
  if (role.startsWith("terminal") || role.startsWith("code")) return "Code and terminal";
  if (role.startsWith("message")) return "Messages";
  if (/^(error|warning|update)/u.test(role)) return "Feedback";
  if (["border", "input", "focus"].includes(role)) return "Lines and focus";
  if (/foreground|text|label|placeholder|icon/iu.test(role)) return "Ink";
  if (role.startsWith("accent") && role !== "accentSurface") return "Action";
  return "Ground";
}

const FAMILIES = [
  "Ground",
  "Ink",
  "Lines and focus",
  "Action",
  "Feedback",
  "Messages",
  "Menu",
  "Toolbar",
  "Code and terminal",
] as const;

function Swatch({ value }: { readonly value: string | undefined }) {
  if (value === undefined) return <span className="text-caption text-muted-foreground">—</span>;
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span
        aria-hidden="true"
        className="size-5 shrink-0 rounded-control border"
        style={{ background: value }}
      />
      <code className="min-w-0 truncate font-mono text-caption text-muted-foreground">{value}</code>
    </span>
  );
}

interface TonePaint {
  readonly dot: string;
  readonly text?: string;
  readonly surface: string;
}

const tonePart = (tone: TonePaint, part: keyof TonePaint) => tone[part];

function ColourPage() {
  return (
    <KitDocument
      line="Every colour is a theme role, painted per appearance; the app reads the role, never the value."
      title="Colour"
    >
      {FAMILIES.map((family) => {
        const roles = THEME_COLOR_ROLES.filter((role) => roleFamily(role) === family);
        if (roles.length === 0) return null;
        return (
          <Section count={roles.length} key={family} title={family}>
            <Card variant="flat">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Role</TableHead>
                    <TableHead>Light</TableHead>
                    <TableHead>Dark</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {roles.map((role) => (
                    <TableRow key={role}>
                      <TableCell>
                        <span className="flex flex-col">
                          <code className="font-mono font-medium text-caption">{role}</code>
                          <code className="font-mono text-caption text-muted-foreground">
                            {WEB_THEME_ROLE_TOKENS[role].join(", ") || "native clients only"}
                          </code>
                        </span>
                      </TableCell>
                      <TableCell>
                        <Swatch value={LIGHT?.[role]} />
                      </TableCell>
                      <TableCell>
                        <Swatch value={DARK?.[role]} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </Section>
        );
      })}
      <Section count={Object.keys(SERVICE_STATUS_TONES).length} title="Status tones">
        <Card variant="flat">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tone</TableHead>
                <TableHead>Part</TableHead>
                <TableHead>Light</TableHead>
                <TableHead>Dark</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Object.entries(SERVICE_STATUS_TONES).flatMap(([tone, { light, dark }]) =>
                (["dot", "text", "surface"] as const).map((part, index) => (
                  <TableRow key={`${tone}-${part}`}>
                    <TableCell>
                      {index === 0 ? (
                        <code className="font-mono font-medium text-caption">{tone}</code>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <code className="font-mono text-caption text-muted-foreground">
                        {part === "dot" ? `bg-status-${tone}` : `status-${tone}-${part}`}
                      </code>
                    </TableCell>
                    <TableCell>
                      <Swatch value={tonePart(light, part)} />
                    </TableCell>
                    <TableCell>
                      <Swatch value={tonePart(dark, part)} />
                    </TableCell>
                  </TableRow>
                )),
              )}
            </TableBody>
          </Table>
        </Card>
      </Section>
      <Section title="Identity">
        <Card variant="flat">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mark</TableHead>
                <TableHead>Light</TableHead>
                <TableHead>Dark</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>
                  <code className="font-mono font-medium text-caption">mint</code>
                </TableCell>
                <TableCell>
                  <Swatch value={IDENTITY.mint.light} />
                </TableCell>
                <TableCell>
                  <Swatch value={IDENTITY.mint.dark} />
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>
                  <code className="font-mono font-medium text-caption">pillTint</code>
                </TableCell>
                <TableCell>
                  <Swatch value={IDENTITY.pillTint.light} />
                </TableCell>
                <TableCell>
                  <Swatch value={IDENTITY.pillTint.dark} />
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Card>
      </Section>
    </KitDocument>
  );
}

/** The type steps as utilities; static, so the class guard can read them. */
const TYPE_CLASS: Readonly<Record<keyof typeof TYPE_SCALE, string>> = {
  caption: "text-caption",
  body: "text-body",
  emphasis: "text-emphasis",
  title: "text-title",
  display: "text-display",
};

const TYPE_USE: Readonly<Record<keyof typeof TYPE_SCALE, string>> = {
  caption: "Meta, counts, a row's second line",
  body: "Every control and most text",
  emphasis: "A section's or a card's heading",
  title: "A page's title",
  display: "A figure, a hero's one line",
};

function TypePage() {
  return (
    <KitDocument
      line="Five steps from packages/shared/src/brand.ts. A size between two steps takes the nearer one."
      title="Type"
    >
      <Card variant="flat">
        {(Object.keys(TYPE_SCALE) as Array<keyof typeof TYPE_SCALE>).toReversed().map((step) => (
          <div className="flex items-baseline gap-6 border-b px-5 py-4 last:border-b-0" key={step}>
            <span className="flex w-44 shrink-0 flex-col">
              <code className="font-mono font-medium text-caption">{TYPE_CLASS[step]}</code>
              <code className="font-mono text-caption text-muted-foreground">
                {TYPE_SCALE[step].fontSize} / {TYPE_SCALE[step].lineHeight} px
              </code>
            </span>
            <span className={`min-w-0 flex-1 truncate ${TYPE_CLASS[step]}`}>
              Fen deployed the storefront
            </span>
            <span className="w-56 shrink-0 text-caption text-muted-foreground">
              {TYPE_USE[step]}
            </span>
          </div>
        ))}
      </Card>
    </KitDocument>
  );
}

const SPACING_STEPS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16] as const;
const SPACING_WIDTH: Readonly<Record<(typeof SPACING_STEPS)[number], string>> = {
  1: "w-1",
  2: "w-2",
  3: "w-3",
  4: "w-4",
  5: "w-5",
  6: "w-6",
  8: "w-8",
  10: "w-10",
  12: "w-12",
  16: "w-16",
};

function SpacingPage() {
  return (
    <KitDocument
      line={`Every gap, padding and line height is a multiple of ${SPACING_UNIT} px. A heading hugs its rows; groups stand at least twice as far apart.`}
      title="Spacing"
    >
      <Card variant="flat">
        {SPACING_STEPS.map((step) => (
          <div className="flex items-center gap-6 border-b px-5 py-2.5 last:border-b-0" key={step}>
            <code className="w-24 shrink-0 font-mono font-medium text-caption">
              {step} · {step * SPACING_UNIT} px
            </code>
            <span className={`h-4 shrink-0 rounded-mark bg-primary/50 ${SPACING_WIDTH[step]}`} />
            <code className="font-mono text-caption text-muted-foreground">
              gap-{step} p-{step} m-{step}
            </code>
          </div>
        ))}
      </Card>
    </KitDocument>
  );
}

function RadiusPage() {
  return (
    <KitDocument
      line="Four radii that nest and run parallel: each outer edge is the inner one plus the 4 px between them."
      title="Radius"
    >
      <div className="flex flex-col gap-10">
        <div className="flex flex-col items-start gap-3">
          <div className="rounded-sheet border bg-muted p-1">
            <div className="rounded-card border bg-card p-1">
              <div className="flex h-10 w-56 items-center justify-between rounded-control bg-foreground ps-3 pe-1 text-background text-body">
                Control
                <span className="flex h-8 items-center rounded-mark bg-background/20 px-2 text-caption">
                  Mark
                </span>
              </div>
            </div>
          </div>
          <span className="text-caption text-muted-foreground">
            Mark inside control inside card inside sheet, 4 px apart
          </span>
        </div>
        <div className="flex flex-wrap items-start gap-8">
          {(
            [
              ["mark", "rounded-mark", "A key, a checkbox, a swatch, inline code"],
              ["control", "rounded-control", "A press, a field, a toggle, a row"],
              ["card", "rounded-card", "A card, a menu's popup"],
              ["sheet", "rounded-sheet", "A sheet, a dialog"],
            ] as const
          ).map(([name, utility, use]) => (
            <div className="flex w-40 flex-col gap-3" key={name}>
              <div className={`size-24 border bg-card ${utility}`} />
              <span className="flex flex-col">
                <code className="font-mono font-medium text-caption">
                  {utility} · {RADII[name]} px
                </code>
                <span className="text-caption text-muted-foreground">{use}</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </KitDocument>
  );
}

const DURATION_CLASS: Readonly<Record<keyof typeof MOTION.duration, string>> = {
  quick: "duration-150",
  base: "duration-200",
  slow: "duration-260",
};

const DURATION_USE: Readonly<Record<keyof typeof MOTION.duration, string>> = {
  quick: "A press answering, a hover, a chevron",
  base: "A popup, a panel's height",
  slow: "A sheet, a page-sized move",
};

/** One easing, drawn as its curve: time across, progress up. */
function Curve({ bezier }: { readonly bezier: string }) {
  const [x1, y1, x2, y2] = (/\(([^)]+)\)/u.exec(bezier)?.[1] ?? "0,0,1,1")
    .split(",")
    .map((part) => Number(part.trim()));
  const at = (x: number | undefined, y: number | undefined) =>
    `${4 + (x ?? 0) * 88} ${92 - (y ?? 0) * 88}`;
  return (
    <svg aria-hidden="true" className="size-24 text-primary" viewBox="0 0 96 96">
      <rect className="fill-muted" height="96" rx="8" width="96" />
      <path
        className="fill-none stroke-current"
        d={`M ${at(0, 0)} C ${at(x1, y1)} ${at(x2, y2)} ${at(1, 1)}`}
        strokeLinecap="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function MotionRow({ step }: { readonly step: keyof typeof MOTION.duration }) {
  const [moved, setMoved] = useState(false);
  return (
    <div className="flex items-center gap-6 border-b px-5 py-3 last:border-b-0">
      <span className="flex w-44 shrink-0 flex-col">
        <code className="font-mono font-medium text-caption">--duration-{step}</code>
        <code className="font-mono text-caption text-muted-foreground">
          {MOTION.duration[step]} ms
        </code>
      </span>
      <Button
        aria-label={`Play ${step}`}
        onClick={() => setMoved((value) => !value)}
        size="icon-sm"
        variant="secondary"
      >
        <PlayIcon />
      </Button>
      <span className="relative h-6 w-48 shrink-0 rounded-control bg-muted">
        <span
          className={`absolute top-1 left-1 size-4 rounded-mark bg-primary transition-transform ease-out-strong motion-reduce:transition-none ${DURATION_CLASS[step]} ${moved ? "translate-x-42" : "translate-x-0"}`}
        />
      </span>
      <span className="text-caption text-muted-foreground">{DURATION_USE[step]}</span>
    </div>
  );
}

function MotionPage() {
  return (
    <KitDocument
      line="Only what the person did animates: three durations, one strong ease-out for what arrives, one ease-in-out for a paired enter and leave. Reduced motion places instead."
      title="Motion"
    >
      <Section title="Durations">
        <Card variant="flat">
          {(Object.keys(MOTION.duration) as Array<keyof typeof MOTION.duration>).map((step) => (
            <MotionRow key={step} step={step} />
          ))}
        </Card>
      </Section>
      <Section title="Curves">
        <div className="flex flex-wrap gap-8">
          {(
            [
              ["ease-out-strong", MOTION.easing.out, "What arrives or answers a press"],
              ["ease-in-out-strong", MOTION.easing.inOut, "A paired enter and leave"],
            ] as const
          ).map(([name, bezier, use]) => (
            <div className="flex items-center gap-4" key={name}>
              <Curve bezier={bezier} />
              <span className="flex flex-col gap-1">
                <code className="font-mono font-medium text-caption">{name}</code>
                <code className="font-mono text-caption text-muted-foreground">{bezier}</code>
                <span className="text-caption text-muted-foreground">{use}</span>
                <span>
                  <Badge tone="neutral">{name === "ease-out-strong" ? "Default" : "Paired"}</Badge>
                </span>
              </span>
            </div>
          ))}
        </div>
      </Section>
    </KitDocument>
  );
}

export function FoundationsPage({ foundation }: { readonly foundation: FoundationId }) {
  switch (foundation) {
    case "colour":
      return <ColourPage />;
    case "type":
      return <TypePage />;
    case "spacing":
      return <SpacingPage />;
    case "radius":
      return <RadiusPage />;
    case "motion":
      return <MotionPage />;
  }
}
