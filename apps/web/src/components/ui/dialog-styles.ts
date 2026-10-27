/**
 * Where a dialog stands: a fixed distance from the top, never centred, so content that grows or
 * changes moves only its bottom edge — the top, the title and what the person was reading hold.
 */
const DIALOG_VIEWPORT_CLASS =
  "fixed inset-0 z-50 grid grid-rows-[minmax(1rem,12vh)_auto_1fr] justify-items-center p-4";

const DIALOG_BACKDROP_CLASS =
  "dialog-backdrop fixed inset-0 z-50 transition-all duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0";

/** The same tint without the blur: behind a dialog that follows work the app goes on with. */
const DIALOG_BACKDROP_PLAIN_CLASS =
  "dialog-backdrop-plain fixed inset-0 z-50 transition-all duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0";

/** Near black in both themes: behind a picture or a video shown as large as the window lets it be. */
const DIALOG_BACKDROP_MEDIA_CLASS =
  "dialog-media-backdrop fixed inset-0 z-50 transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0";

const DIALOG_POPUP_CLASS =
  "dialog-glass -translate-y-[calc(1.25rem*var(--nested-dialogs))] relative flex min-h-0 w-full min-w-0 scale-[calc(1-0.1*var(--nested-dialogs))] flex-col rounded-2xl border opacity-[calc(1-0.1*var(--nested-dialogs))] outline-none transition-[scale,opacity,translate] duration-200 ease-in-out will-change-transform data-nested:data-ending-style:translate-y-8 data-nested:data-starting-style:translate-y-8 data-nested-dialog-open:origin-top data-ending-style:scale-98 data-starting-style:scale-98 data-ending-style:opacity-0 data-starting-style:opacity-0 [-webkit-app-region:no-drag]";

const DIALOG_MOBILE_SHEET_CLASS =
  "max-sm:max-w-none max-sm:rounded-none max-sm:border-x-0 max-sm:border-t max-sm:border-b-0 max-sm:opacity-[calc(1-min(var(--nested-dialogs),1))] max-sm:data-ending-style:translate-y-4 max-sm:data-starting-style:translate-y-4";

export {
  DIALOG_BACKDROP_CLASS,
  DIALOG_BACKDROP_MEDIA_CLASS,
  DIALOG_BACKDROP_PLAIN_CLASS,
  DIALOG_MOBILE_SHEET_CLASS,
  DIALOG_POPUP_CLASS,
  DIALOG_VIEWPORT_CLASS,
};
