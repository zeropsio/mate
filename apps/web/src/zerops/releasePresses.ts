/**
 * When this tab pressed a release, and when it saw production take it: held outside any
 * component, by application and tag. The review's clock counts from the press whatever remounts or
 * follows the release again once HQ lists it — HQ tags a release when it gets to it, which may be
 * a minute after the press — and "took" is the press to live. A tab that did not press holds
 * nothing here and says HQ's own times.
 */
import { create } from "zustand";

export interface ReleasePress {
  /** ISO, this browser's clock at the press. */
  readonly pressedAt: string;
  /** ISO, when this tab first saw the release live. */
  readonly liveAt?: string;
}

interface ReleasePressesState {
  readonly presses: Readonly<Record<string, ReleasePress>>;
  readonly pressed: (appId: string, tag: string, at: string) => void;
  /** HQ made the release under another tag than the one pressed. */
  readonly renamed: (appId: string, from: string, to: string) => void;
  /** HQ refused the press: nothing was started. */
  readonly refused: (appId: string, tag: string) => void;
  /** The first sight of it live; later ones change nothing. */
  readonly live: (appId: string, tag: string, at: string) => void;
}

export const releasePressKey = (appId: string, tag: string) => `${appId} ${tag}`;

export const useReleasePresses = create<ReleasePressesState>((set) => ({
  presses: {},
  pressed: (appId, tag, at) =>
    set((state) => ({
      presses: { ...state.presses, [releasePressKey(appId, tag)]: { pressedAt: at } },
    })),
  renamed: (appId, from, to) =>
    set((state) => {
      const press = state.presses[releasePressKey(appId, from)];
      if (press === undefined || from === to) return state;
      const { [releasePressKey(appId, from)]: _moved, ...rest } = state.presses;
      return { presses: { ...rest, [releasePressKey(appId, to)]: press } };
    }),
  refused: (appId, tag) =>
    set((state) => {
      const { [releasePressKey(appId, tag)]: _refused, ...rest } = state.presses;
      return { presses: rest };
    }),
  live: (appId, tag, at) =>
    set((state) => {
      const press = state.presses[releasePressKey(appId, tag)];
      if (press === undefined || press.liveAt !== undefined) return state;
      return {
        presses: { ...state.presses, [releasePressKey(appId, tag)]: { ...press, liveAt: at } },
      };
    }),
}));
