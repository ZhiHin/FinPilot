import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Class-name combiner for component variants (shadcn idiom). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
