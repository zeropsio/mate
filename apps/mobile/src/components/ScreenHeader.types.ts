import type { AppSymbolName } from "./AppSymbol";

export type ScreenHeaderMenuItem =
  | {
      readonly id: string;
      readonly title: string;
      readonly icon?: string;
      readonly subtitle?: string;
      readonly disabled?: boolean;
      readonly selected?: boolean;
      readonly onPress: () => void;
    }
  | {
      readonly id: string;
      readonly title?: string;
      readonly icon?: string;
      readonly inline?: boolean;
      readonly items: ReadonlyArray<ScreenHeaderMenuItem>;
    };

export interface ScreenHeaderMenu {
  readonly title: string;
  readonly icon: AppSymbolName;
  readonly status?: string;
  readonly separateBackground?: boolean;
  readonly items: ReadonlyArray<ScreenHeaderMenuItem>;
}
