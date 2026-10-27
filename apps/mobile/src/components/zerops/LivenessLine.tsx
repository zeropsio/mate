import { View } from "react-native";

import { SymbolView } from "../AppSymbol";
import { AppText } from "../AppText";
import { livenessLinePresentation } from "./presentation.ts";

export function LivenessLine(props: Parameters<typeof livenessLinePresentation>[0]) {
  const presentation = livenessLinePresentation(props);
  if (!presentation.visible) return null;

  return (
    <View className={presentation.containerClassName}>
      <SymbolView
        name={presentation.icon}
        size={presentation.iconSize}
        tintColorClassName={presentation.iconTintClassName}
        type={presentation.iconType}
      />
      <AppText className={presentation.textClassName}>{presentation.label}</AppText>
    </View>
  );
}
