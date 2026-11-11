import type { ComponentType } from "react";
import {
  ArchiveIcon,
  BotIcon,
  CloudIcon,
  DramaIcon,
  GitBranchIcon,
  KeyboardIcon,
  Link2Icon,
  PaletteIcon,
  Settings2Icon,
  UsersIcon,
  WalletIcon,
  WorkflowIcon,
} from "lucide-react";

import type { SettingsPath } from "./settingsSearch";

/** Each settings section's glyph: its row in the settings nav, and where ⌘K finds it. */
export const SETTINGS_SECTION_ICONS: Readonly<
  Record<SettingsPath, ComponentType<{ className?: string }>>
> = {
  "/settings/general": Settings2Icon,
  "/settings/appearance": PaletteIcon,
  "/settings/keybindings": KeyboardIcon,
  "/settings/providers": BotIcon,
  "/settings/source-control": GitBranchIcon,
  "/settings/connections": Link2Icon,
  "/settings/zerops": CloudIcon,
  "/settings/automation": WorkflowIcon,
  "/settings/team": UsersIcon,
  "/settings/billing": WalletIcon,
  "/settings/personas": DramaIcon,
  "/settings/archived": ArchiveIcon,
};
