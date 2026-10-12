import type { SVGProps } from "react";
import { HouseMark } from "./ui/icons";

/**
 * The product's name and mark, in one place so a rename is one change.
 * The name is a placeholder until the product is named for launch.
 */
export const BRAND = { name: "HomeDesign" } as const;

/** The brand mark (the house), optionally with the name beside it. */
export function Logo({ withName = false, size = 26, ...props }: { withName?: boolean; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <>
      <HouseMark width={size} height={size} aria-hidden {...props} />
      {withName && <span>{BRAND.name}</span>}
    </>
  );
}
