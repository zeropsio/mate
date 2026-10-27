/**
 * The release dialog's two steps: the release, and one of the changes it carries, read in place.
 *
 * A change row steps the dialog into that change's review without closing it; back — the
 * control, or the first Esc — returns to the release scrolled where it was, the row that was
 * pressed taking the focus again; Esc on the release closes the dialog.
 */

/** The change a release row opens: its repository and its number there. */
export interface ReleaseStepChange {
  readonly repository: string;
  readonly number: number;
}

export type ReleaseStep =
  | {
      readonly view: "release";
      /** Where the release was scrolled when it was left. */
      readonly scrollTop: number;
      /** The row that stepped into a change, which takes the focus back. */
      readonly returnTo: string | undefined;
    }
  | {
      readonly view: "change";
      readonly change: ReleaseStepChange;
      readonly rowKey: string;
      readonly releaseScroll: number;
    };

export type ReleaseStepEvent =
  | {
      readonly kind: "open";
      readonly change: ReleaseStepChange;
      readonly rowKey: string;
      readonly releaseScroll: number;
    }
  | { readonly kind: "back" }
  | { readonly kind: "escape" };

export const RELEASE_STEP_START: ReleaseStep = {
  view: "release",
  scrollTop: 0,
  returnTo: undefined,
};

export function releaseStep(
  state: ReleaseStep,
  event: ReleaseStepEvent,
): { readonly state: ReleaseStep; readonly closes: boolean } {
  switch (event.kind) {
    case "open":
      return {
        state: {
          view: "change",
          change: event.change,
          rowKey: event.rowKey,
          // Left from a change, the release is where it was left from the release.
          releaseScroll: state.view === "change" ? state.releaseScroll : event.releaseScroll,
        },
        closes: false,
      };
    case "back":
    case "escape":
      if (state.view === "release") return { state, closes: event.kind === "escape" };
      return {
        state: { view: "release", scrollTop: state.releaseScroll, returnTo: state.rowKey },
        closes: false,
      };
  }
}
