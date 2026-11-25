import { ZEROPS_RING } from "@t3tools/shared/brand";
import Svg, { Path } from "react-native-svg";

const [, , VIEWBOX_WIDTH = 1, VIEWBOX_HEIGHT = 1] = ZEROPS_RING.viewBox.split(" ").map(Number);
const MARK_ASPECT_RATIO = VIEWBOX_WIDTH / VIEWBOX_HEIGHT;

/** Zerops the company's ring, where the app shows Zerops itself: signing in, the account. */
export function ZeropsMark(props: { readonly height: number }) {
  return (
    <Svg
      accessibilityElementsHidden
      accessible={false}
      focusable={false}
      height={props.height}
      importantForAccessibility="no"
      viewBox={ZEROPS_RING.viewBox}
      width={props.height * MARK_ASPECT_RATIO}
    >
      {ZEROPS_RING.paths.map((path) => (
        <Path d={path.d} fill={path.fill} key={path.d} />
      ))}
    </Svg>
  );
}
