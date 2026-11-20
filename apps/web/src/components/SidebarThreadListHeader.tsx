import { SearchIcon, XIcon } from "lucide-react";
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";
import { Button } from "./ui/button";
import { SidebarInput } from "./ui/sidebar";

export function SidebarThreadSearchField({
  threadSearchInputRef,
  threadSearchQuery,
  setThreadSearchQuery,
  setActiveSearchResultIndex,
  handleThreadSearchKeyDown,
  isSearchingThreads,
  threadSearchResults,
  activeSearchResultIndex,
  threadSearch,
  clearThreadSearch,
}: {
  threadSearchInputRef: RefObject<HTMLInputElement | null>;
  threadSearchQuery: string;
  setThreadSearchQuery: (query: string) => void;
  setActiveSearchResultIndex: (index: number) => void;
  handleThreadSearchKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  isSearchingThreads: boolean;
  threadSearchResults: ReadonlyArray<unknown>;
  activeSearchResultIndex: number;
  threadSearch: { readonly isPending: boolean; readonly incomplete: boolean };
  clearThreadSearch: () => void;
}) {
  return (
    <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground">
      <SearchIcon className="size-4 shrink-0 text-sidebar-muted-foreground/80" />
      <SidebarInput
        ref={threadSearchInputRef}
        nativeInput
        type="search"
        value={threadSearchQuery}
        onChange={(event) => {
          setThreadSearchQuery(event.currentTarget.value);
          setActiveSearchResultIndex(0);
        }}
        onKeyDown={handleThreadSearchKeyDown}
        placeholder="Search"
        aria-label="Search threads"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={isSearchingThreads && threadSearchResults.length > 0}
        aria-controls={
          isSearchingThreads && threadSearchResults.length > 0
            ? "sidebar-thread-search-results"
            : undefined
        }
        aria-activedescendant={
          isSearchingThreads && threadSearchResults[activeSearchResultIndex]
            ? `sidebar-thread-search-result-${activeSearchResultIndex}`
            : undefined
        }
        className="min-w-0 flex-1"
      />
      {isSearchingThreads &&
      threadSearch.incomplete &&
      !threadSearch.isPending &&
      threadSearchResults.length > 0 ? (
        <p role="status" className="px-2 text-xs text-sidebar-muted-foreground">
          Some conversations could not be searched.
        </p>
      ) : null}
      {isSearchingThreads ? (
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          className="shrink-0 text-sidebar-muted-foreground hover:bg-sidebar-control-surface hover:text-sidebar-foreground"
          aria-label="Clear thread search"
          onClick={() => {
            clearThreadSearch();
            threadSearchInputRef.current?.focus();
          }}
        >
          <XIcon className="size-3" />
        </Button>
      ) : null}
    </div>
  );
}
