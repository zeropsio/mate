import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { SearchIcon, XIcon } from "lucide-react";
import { useLocation, useNavigate } from "@tanstack/react-router";

import { Button } from "../ui/button";
import { Kbd } from "../ui/kbd";
import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
  SidebarInput,
} from "../ui/sidebar";
import { SidebarUtilityMenu } from "../sidebar/SidebarChrome";
import { AccountVoiceLine } from "../zerops/AccountVoiceLine";
import { SectionLabel } from "../zerops/system";
import { useZeropsSessionOptional } from "~/zerops/sessionContext";
import { scrollToSettingsTarget } from "./settingsLayout";
import {
  ORGANIZATION_PAGES,
  searchSettings,
  SETTINGS_NAV_GROUPS,
  SETTINGS_SECTION_LABELS,
  type SettingsPath,
  type SettingsSearchItem,
} from "./settingsSearch";
import { SETTINGS_SECTION_ICONS } from "./settingsSectionIcons";

function SettingsSectionIcon({ to }: { to: SettingsPath }) {
  const Icon = SETTINGS_SECTION_ICONS[to];
  return <Icon className="mt-0.5 size-3.5 shrink-0 text-sidebar-muted-foreground/60" />;
}

/** The nav's groups, each with the sections it shows: an empty group is not drawn. */
const shownNavGroups = (withOrganization: boolean) =>
  SETTINGS_NAV_GROUPS.map((group) => ({
    label: group.label,
    sections: group.sections.filter((to) => withOrganization || !ORGANIZATION_PAGES.has(to)),
  })).filter((group) => group.sections.length > 0);

export function SettingsSidebarNav({ pathname }: { pathname: string }) {
  const navigate = useNavigate();
  const navGroups = shownNavGroups(useZeropsSessionOptional()?.activeOrganization != null);
  const currentHash = useLocation({ select: (location) => location.hash });
  const { isMobile, setOpenMobile, open, setOpen } = useSidebar();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [activeResultIndex, setActiveResultIndex] = useState(0);
  const results = useMemo(() => searchSettings(query), [query]);
  const isSearching = query.trim().length > 0;
  const hasResults = results.length > 0;

  useEffect(() => {
    const result = results[activeResultIndex];
    if (!result) return;
    document
      .getElementById(`settings-search-result-${result.id}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeResultIndex, results]);

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;

      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable ||
          // Keep focus inside open dialogs and popups instead of escaping
          // their focus trap into the sidebar search.
          target.closest('[role="dialog"], [aria-modal="true"], [data-slot$="popup"]') !== null)
      ) {
        return;
      }

      event.preventDefault();
      if (isMobile) {
        setOpenMobile(true);
      } else if (!open) {
        setOpen(true);
      }
      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      });
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isMobile, open, setOpen, setOpenMobile]);

  const handleSectionClick = useCallback(
    (to: SettingsPath) => {
      if (isMobile) {
        setOpenMobile(false);
      }
      void navigate({ to, hash: "", replace: true, hashScrollIntoView: false });
    },
    [isMobile, navigate, setOpenMobile],
  );
  const clearSearch = useCallback(() => {
    setQuery("");
    setActiveResultIndex(0);
  }, []);
  const handleSearchResultClick = useCallback(
    (item: SettingsSearchItem) => {
      clearSearch();
      if (isMobile) {
        setOpenMobile(false);
      }
      const targetId = item.targetId ?? item.id;
      if (pathname === item.to && currentHash.replace(/^#/, "") === targetId) {
        scrollToSettingsTarget(targetId);
        return;
      }
      void navigate({ to: item.to, hash: targetId, replace: true, hashScrollIntoView: false });
    },
    [clearSearch, currentHash, isMobile, navigate, pathname, setOpenMobile],
  );
  const handleSearchKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Escape" && isSearching) {
        event.preventDefault();
        event.stopPropagation();
        clearSearch();
        return;
      }
      if (results.length === 0) return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveResultIndex((index) => (index + 1) % results.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveResultIndex((index) => (index - 1 + results.length) % results.length);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const result = results[activeResultIndex];
        if (result) handleSearchResultClick(result);
      }
    },
    [activeResultIndex, clearSearch, handleSearchResultClick, isSearching, results],
  );
  return (
    <>
      <SidebarContent className="overflow-x-hidden">
        <SidebarGroup>
          <div className="flex flex-col gap-2">
            <div className="flex h-8 items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground pointer-coarse:h-10">
              <SearchIcon className="size-4 shrink-0 text-sidebar-muted-foreground/80" />
              <SidebarInput
                ref={searchInputRef}
                nativeInput
                type="search"
                value={query}
                onChange={(event) => {
                  setQuery(event.currentTarget.value);
                  setActiveResultIndex(0);
                }}
                onKeyDown={handleSearchKeyDown}
                placeholder="Search"
                aria-label="Search settings"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={isSearching && hasResults}
                aria-controls={isSearching && hasResults ? "settings-search-results" : undefined}
                aria-activedescendant={
                  isSearching && results[activeResultIndex]
                    ? `settings-search-result-${results[activeResultIndex].id}`
                    : undefined
                }
                className="min-w-0 flex-1"
              />
              {isSearching ? (
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  className="shrink-0"
                  aria-label="Clear settings search"
                  onClick={() => {
                    clearSearch();
                    searchInputRef.current?.focus();
                  }}
                >
                  <XIcon className="size-3" />
                </Button>
              ) : (
                // A key to press: said only where there is a keyboard to press it on.
                <span className="flex pointer-coarse:hidden">
                  <Kbd>/</Kbd>
                </span>
              )}
            </div>
            {isSearching && results.length === 0 ? (
              <p
                role="status"
                className="px-2 py-6 text-center text-xs text-sidebar-muted-foreground"
              >
                No settings found
              </p>
            ) : null}
            {isSearching ? (
              <SidebarMenu
                id={hasResults ? "settings-search-results" : undefined}
                role={hasResults ? "listbox" : undefined}
                aria-label={hasResults ? "Settings search results" : undefined}
              >
                {results.map((item, index) => (
                  <SidebarMenuItem key={item.id} role="presentation">
                    <SidebarMenuButton
                      id={`settings-search-result-${item.id}`}
                      role="option"
                      aria-selected={index === activeResultIndex}
                      tabIndex={-1}
                      size="sm"
                      isActive={index === activeResultIndex}
                      className="h-auto min-h-10 items-start"
                      onMouseMove={() => setActiveResultIndex(index)}
                      onClick={() => handleSearchResultClick(item)}
                    >
                      <SettingsSectionIcon to={item.to} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-sidebar-foreground">
                          {item.title}
                        </span>
                        <span className="block truncate text-2xs text-sidebar-muted-foreground/75">
                          {SETTINGS_SECTION_LABELS[item.to]}
                        </span>
                      </span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            ) : (
              // Grouped by whose settings they are; the gap between groups is twice a label's.
              <div className="flex flex-col gap-4 pt-1">
                {navGroups.map((group, index) => (
                  <div
                    aria-labelledby={`settings-nav-group-${String(index)}`}
                    key={group.label}
                    role="group"
                  >
                    <div className="px-2.5">
                      <SectionLabel id={`settings-nav-group-${String(index)}`}>
                        {group.label}
                      </SectionLabel>
                    </div>
                    <SidebarMenu>
                      {group.sections.map((to) => {
                        const Icon = SETTINGS_SECTION_ICONS[to];
                        const isActive = pathname === to || pathname.startsWith(`${to}/`);
                        return (
                          <SidebarMenuItem key={to}>
                            <SidebarMenuButton
                              // A finger's row on a touch screen: 40 px, where a pointer's is 32.
                              className="pointer-coarse:h-10"
                              isActive={isActive}
                              onClick={() => handleSectionClick(to)}
                            >
                              <Icon />
                              <span className="truncate">{SETTINGS_SECTION_LABELS[to]}</span>
                            </SidebarMenuButton>
                          </SidebarMenuItem>
                        );
                      })}
                    </SidebarMenu>
                  </div>
                ))}
              </div>
            )}
          </div>
        </SidebarGroup>
      </SidebarContent>
      {/* The account's one line, as at the menu's foot: settings replace the menu, not the lapse. */}
      <AccountVoiceLine />
      <SidebarFooter className="p-[var(--sidebar-content-inset)]">
        <SidebarUtilityMenu />
      </SidebarFooter>
    </>
  );
}
