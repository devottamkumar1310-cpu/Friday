import * as React from 'react';
import { cn } from '../lib/cn';

/**
 * Phase 1 foundation primitives — typography + spacing contract for the
 * redesign. Additive only; no existing page is migrated yet.
 *
 * - PageHeader: one H1 + optional description + optional actions per screen.
 *   Enforces the "one primary action per screen" principle structurally.
 * - SectionHeader: eyebrow + title + optional description for sections.
 * - ContentNarrow/Form/App/Wide: content-width wells backed by tokens.
 */

export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  className,
}: {
  title: string;
  description?: string;
  eyebrow?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="space-y-1.5">
        {eyebrow && (
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {eyebrow}
          </p>
        )}
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          {title}
        </h1>
        {description && <p className="max-w-prose text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function SectionHeader({
  title,
  description,
  eyebrow,
  className,
  id,
}: {
  title: string;
  description?: string;
  eyebrow?: string;
  className?: string;
  /** Applied to the heading so sections can use aria-labelledby. */
  id?: string;
}) {
  return (
    <div className={cn('space-y-1', className)}>
      {eyebrow && (
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {eyebrow}
        </p>
      )}
      <h2 id={id} className="text-lg font-semibold tracking-tight text-foreground">{title}</h2>
      {description && <p className="max-w-prose text-sm text-muted-foreground">{description}</p>}
    </div>
  );
}
