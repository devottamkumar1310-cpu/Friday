import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge class names, with later Tailwind utilities winning over earlier ones.
 * Lets a caller override a component's defaults by passing `className`, which
 * is what makes composition-over-configuration practical.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
