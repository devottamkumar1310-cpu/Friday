/**
 * @friday/ui — the design system.
 *
 * shadcn-style: components are copied in and owned rather than consumed from a
 * library, so there is no upstream version pressure and no fight when a
 * behaviour needs to change. Radix supplies the accessibility primitives that
 * are genuinely hard to get right; the styling is ours.
 *
 * Presentational only — this package may not import domain, data, or model
 * code. Pass data in as props.
 */

export { cn } from './lib/cn';

export * from './primitives/button';
export * from './primitives/input';
export * from './primitives/card';
export * from './primitives/dialog';
export * from './primitives/sheet';
export * from './primitives/tabs';
export * from './primitives/badge';
export * from './primitives/progress';
export * from './primitives/skeleton';
export * from './primitives/toast';
export * from './primitives/states';
