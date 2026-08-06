import * as React from 'react';
import { cn } from '../lib/cn';

type DivProps = React.HTMLAttributes<HTMLDivElement>;

export const Card = React.forwardRef<HTMLDivElement, DivProps>(function Card(
  { className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn('rounded-xl border border-border bg-surface shadow-sm', className)}
      {...props}
    />
  );
});

export const CardHeader = React.forwardRef<HTMLDivElement, DivProps>(function CardHeader(
  { className, ...props },
  ref,
) {
  return <div ref={ref} className={cn('flex flex-col gap-1.5 p-6', className)} {...props} />;
});

export const CardTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(function CardTitle({ className, ...props }, ref) {
  return (
    <h3
      ref={ref}
      className={cn('font-semibold leading-tight tracking-tight', className)}
      {...props}
    />
  );
});

export const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(function CardDescription({ className, ...props }, ref) {
  return <p ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />;
});

export const CardContent = React.forwardRef<HTMLDivElement, DivProps>(function CardContent(
  { className, ...props },
  ref,
) {
  return <div ref={ref} className={cn('p-6 pt-0', className)} {...props} />;
});

export const CardFooter = React.forwardRef<HTMLDivElement, DivProps>(function CardFooter(
  { className, ...props },
  ref,
) {
  return <div ref={ref} className={cn('flex items-center gap-2 p-6 pt-0', className)} {...props} />;
});
