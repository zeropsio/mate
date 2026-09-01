import { ZEROPS_MARK } from "@t3tools/shared/brand";
import Svg, { Path } from "react-native-svg";

const [, , VIEWBOX_WIDTH, VIEWBOX_HEIGHT] = ZEROPS_MARK.viewBox.split(" ").map(Number);
const MARK_ASPECT_RATIO = VIEWBOX_WIDTH / VIEWBOX_HEIGHT;

export function ZeropsMark(props: { readonly height: number }) {
  return (
    <Svg
      accessibilityElementsHidden
      accessible={false}
      focusable={false}
      height={props.height}
      importantForAccessibility="no"
      viewBox={ZEROPS_MARK.viewBox}
      width={props.height * MARK_ASPECT_RATIO}
    >
      {ZEROPS_MARK.paths.map((path) => (
        <Path d={path.d} fill={path.fill} key={path.d} />
      ))}
    </Svg>
  );
}
