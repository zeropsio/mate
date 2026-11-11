/**
 * The app's own pages as the jump box finds them (`JumpPage`): the overview, Git and Usage as the
 * account menu names them, each settings section by its name, and each setting by its title through the settings' own search
 * (`searchSettings`), opened on its section scrolled to it, as the settings nav's search does.
 */
import {
  settingsPageOffered,
  searchSettings,
  SETTINGS_SECTION_LABELS,
  type SettingsPath,
} from "../settings/settingsSearch";
import type { JumpPage } from "./JumpBox.logic";
import {
  SIDEBAR_ACCOUNT_DESTINATIONS,
  type SidebarAccountDestination,
} from "./SidebarZeropsAccount.logic";

const fold = (text: string) => text.toLocaleLowerCase();

const accountPage = (
  id: SidebarAccountDestination["id"],
  to: Extract<JumpPage["to"], "/zerops" | "/git" | "/usage">,
): JumpPage => ({
  key: id,
  title: SIDEBAR_ACCOUNT_DESTINATIONS.find((entry) => entry.id === id)?.label ?? id,
  where: undefined,
  glyph: { kind: "destination", id },
  to,
  hash: undefined,
});

/** The account menu's pages beside the settings: the overview, Git, Usage. */
const APP_PAGES: ReadonlyArray<JumpPage> = [
  accountPage("projects", "/zerops"),
  accountPage("git", "/git"),
  accountPage("usage", "/usage"),
];

/**
 * The pages for what was typed. A section is found by its name, or by "settings" with it; a
 * setting titled as its section is the section. `withOrganization`: the viewer is in one, so its
 * team and persona templates are there to open, as the settings nav offers them.
 */
export function findJumpPages(
  text: string,
  viewer: { readonly withOrganization: boolean; readonly readsBilling: boolean },
): ReadonlyArray<JumpPage> {
  const query = fold(text.trim());
  if (query.length === 0) return [];
  const offered = (to: SettingsPath) => settingsPageOffered(to, viewer);
  const sections = (Object.keys(SETTINGS_SECTION_LABELS) as SettingsPath[])
    .filter((to) => offered(to) && fold(`settings ${SETTINGS_SECTION_LABELS[to]}`).includes(query))
    .map((to): JumpPage => ({
      key: `section:${to}`,
      title: SETTINGS_SECTION_LABELS[to],
      where: "Settings",
      glyph: { kind: "section", section: to },
      to,
      hash: undefined,
    }));
  const settings = searchSettings(text)
    .filter(
      (item) => offered(item.to) && fold(item.title) !== fold(SETTINGS_SECTION_LABELS[item.to]),
    )
    .map((item): JumpPage => ({
      key: `setting:${item.id}`,
      title: item.title,
      where: `Settings · ${SETTINGS_SECTION_LABELS[item.to]}`,
      glyph: { kind: "section", section: item.to },
      to: item.to,
      hash: item.targetId ?? item.id,
    }));
  const pages = APP_PAGES.filter((page) => fold(page.title).includes(query));
  return [...pages, ...sections, ...settings];
}
