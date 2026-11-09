import {
  Building2Icon,
  CompassIcon,
  DramaIcon,
  GraduationCapIcon,
  LightbulbIcon,
  MessagesSquareIcon,
  PaletteIcon,
  PenLineIcon,
  ScanSearchIcon,
  ShieldCheckIcon,
  SirenIcon,
  SquareTerminalIcon,
  ZapIcon,
  type LucideIcon,
} from "lucide-react";
import type { MatePersonaTemplateRef } from "@t3tools/contracts";

const PREMADE_ICONS: Readonly<Record<string, LucideIcon>> = {
  guide: CompassIcon,
  explainer: MessagesSquareIcon,
  "creative-partner": LightbulbIcon,
  direct: SquareTerminalIcon,
  prototyper: ZapIcon,
  "careful-engineer": ShieldCheckIcon,
  reviewer: ScanSearchIcon,
  designer: PaletteIcon,
  "on-call": SirenIcon,
  teacher: GraduationCapIcon,
};

/** A persona's mark: its Zerops template's own, the organization's, or the pen of one written by hand. */
export const personaIcon = (template: MatePersonaTemplateRef | undefined): LucideIcon =>
  template === undefined
    ? PenLineIcon
    : template.source === "org"
      ? Building2Icon
      : (PREMADE_ICONS[template.id] ?? DramaIcon);
