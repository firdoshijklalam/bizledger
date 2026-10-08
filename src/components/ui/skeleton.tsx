import { cn } from "@/lib/utils"

/**
 * §SKELETON-SHIMMER: global skeleton uses the .skeleton-shimmer sweep
 * (globals.css) layered over bg-accent — replaces the old flat opacity
 * pulse. prefers-reduced-motion disables the sweep via the media query
 * (skeleton then stays a static muted block, which is the correct
 * reduced-motion behavior).
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("bg-accent skeleton-shimmer rounded-md", className)}
      {...props}
    />
  )
}

export { Skeleton }
