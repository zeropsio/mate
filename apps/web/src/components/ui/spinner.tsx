import { Loader2Icon } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "~/lib/utils";

// No default size: inside a Button the parent's svg rule sizes the glyph.
const spinnerVariants = cva("animate-spin", {
  variants: {
    size: {
      xs: "size-3",
      sm: "size-3.5",
      md: "size-4",
      lg: "size-5",
    },
    tone: {
      current: "",
      muted: "text-muted-foreground",
    },
  },
  defaultVariants: { tone: "current" },
});

function Spinner({
  className,
  size,
  tone,
  ...props
}: React.ComponentProps<typeof Loader2Icon> & VariantProps<typeof spinnerVariants>) {
  return (
    <Loader2Icon
      aria-label="Loading"
      className={cn(spinnerVariants({ size, tone }), className)}
      role="status"
      {...props}
    />
  );
}

export { Spinner };
