import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Classname Utility
 * Responsibility: Merge Tailwind classes safely without style conflicts.
 * Why it exists: Shadcn UI and dynamic component states require safe class injection.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
