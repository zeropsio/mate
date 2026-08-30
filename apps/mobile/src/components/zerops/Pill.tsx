import { Pressable } from "react-native";

import { AppText } from "../AppText";
import { pillPresentation } from "./presentation.ts";

export function Pill(
  props: Parameters<typeof pillPresentation>[0] & {
    readonly onPress?: () => void;
  },
) {
  const presentation = pillPresentation(props);
  return (
    <Pressable
      accessibilityLabel={presentation.label}
      accessibilityRole="button"
      accessibilityState={{ disabled: presentation.disabled }}
      className={presentation.containerClassName}
      disabled={presentation.disabled}
      onPress={props.onPress}
    >
      <AppText className={presentation.textClassName}>{presentation.label}</AppText>
    </Pressable>
  );
}
