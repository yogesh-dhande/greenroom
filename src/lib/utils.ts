/** Joins truthy class names — a minimal `clsx` stand-in so we don't pull in
 * another dependency just for this. */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}
