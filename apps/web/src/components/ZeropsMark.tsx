import { ZEROPS_MARK } from "@t3tools/shared/brand";

export function ZeropsMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox={ZEROPS_MARK.viewBox}
      xmlns="http://www.w3.org/2000/svg"
    >
      {ZEROPS_MARK.paths.map((path) => (
        <path d={path.d} fill={path.fill} key={path.d} />
      ))}
    </svg>
  );
}
