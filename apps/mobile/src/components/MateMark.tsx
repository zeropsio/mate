import { MATE_MARK, MATE_MARK_LIVE } from "@t3tools/shared/brand";
import { useColorScheme } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";

const [, , VIEWBOX_WIDTH = 1, VIEWBOX_HEIGHT = 1] = MATE_MARK.viewBox.split(" ").map(Number);
const MARK_ASPECT_RATIO = VIEWBOX_WIDTH / VIEWBOX_HEIGHT;

/** Mate's face, still and open: the product's own mark, as the web's menu draws it. */
export function MateMark(props: { readonly height: number }) {
  const eyes = useColorScheme() === "dark" ? MATE_MARK.eyes.dark : MATE_MARK.eyes.light;
  return (
    <Svg
      accessibilityElementsHidden
      accessible={false}
      focusable={false}
      height={props.height}
      importantForAccessibility="no"
      viewBox={MATE_MARK.viewBox}
      width={props.height * MARK_ASPECT_RATIO}
    >
      {MATE_MARK.paths.map((d) => (
        <Path d={d} fill={MATE_MARK.color} key={d} />
      ))}
      {MATE_MARK_LIVE.eyeCentres.map((x) => (
        <Rect
          fill={eyes}
          height={MATE_MARK.eyeHeight}
          key={x}
          rx={MATE_MARK.eyeWidth / 2}
          width={MATE_MARK.eyeWidth}
          x={x - MATE_MARK.eyeWidth / 2}
          y={MATE_MARK_LIVE.eyeCentreY - MATE_MARK.eyeHeight / 2}
        />
      ))}
    </Svg>
  );
}
