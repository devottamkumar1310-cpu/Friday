import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '../lib/cn';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ' +
    'transition-colors duration-(--duration-fast) ' +
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ' +
    'disabled:pointer-events-none disabled:opacity-50 ' +
    '[&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground hover:bg-primary-hover',
        secondary: 'bg-surface-raised text-foreground border border-border hover:bg-muted',
        ghost: 'text-foreground hover:bg-muted',
        destructive: 'bg-destructive text-destructive-foreground hover:opacity-90',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        // `min-h`/`min-w` rather than a fixed height: a button whose label
        // wraps on a narrow screen must grow rather than clip its own text.
        // No desktop shrink. 768px and 1024px are tablet widths reached by
        // thumb, and a rule that relaxes above `sm` puts every small button
        // back under the floor on exactly the devices that need it most.
        sm: 'min-h-11 px-3 text-xs',
        md: 'min-h-11 px-4',
        lg: 'min-h-12 px-6 text-base',
        /**
         * 44px, not 40.
         *
         * The audit matrix found every icon button in the product below the
         * tap-target floor at every breakpoint — the mobile navigation
         * disclosure among them, which is the single most important control on
         * a phone. WCAG 2.5.8 sets 24px as the minimum and 44px is the iOS
         * guideline; an icon button is exactly the case the guideline exists
         * for, because there is no text around it to absorb a near-miss.
         */
        icon: 'size-11',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /** Render as the child element, e.g. a Next.js `<Link>`. */
  asChild?: boolean;
  /** Disables the button and shows a spinner. */
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, asChild = false, loading = false, children, disabled, ...props },
  ref,
) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      // Announces the pending state to assistive tech, not just visually.
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <>
          <Loader2 className="animate-spin" aria-hidden />
          {children}
        </>
      ) : (
        children
      )}
    </Comp>
  );
});

export { buttonVariants };
