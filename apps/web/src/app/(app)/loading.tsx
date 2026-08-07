import { Skeleton } from '@friday/ui';

/**
 * §4.4: loading is a **skeleton, not a spinner** — it previews the shape of
 * what is coming, so the page does not visibly reflow when data lands.
 */
export default function AppLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>
      {/*
        `max-w-full` because these are fixed widths: at 320px — the narrowest
        viewport WCAG 1.4.10 requires — `w-80` is wider than the content column,
        and the whole page scrolled sideways for as long as the skeleton showed.
        The intent is "about this wide", never "at least this wide".
      */}
      <div className="space-y-2">
        <Skeleton className="h-8 w-64 max-w-full" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <Skeleton className="h-44 w-full rounded-xl" />
      <div className="grid gap-6 md:grid-cols-2">
        <Skeleton className="h-56 w-full rounded-xl" />
        <Skeleton className="h-56 w-full rounded-xl" />
      </div>
    </div>
  );
}
