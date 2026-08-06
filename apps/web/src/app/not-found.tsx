import Link from 'next/link';
import { Button } from '@friday/ui';

export default function NotFound() {
  return (
    <main
      id="main"
      className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center"
    >
      <p className="font-mono text-sm text-muted-foreground">404</p>
      <h1 className="text-2xl font-semibold tracking-tight">We could not find that</h1>
      <p className="text-sm text-muted-foreground">
        The page may have moved, or it may belong to someone else — FRIDAY does not distinguish
        between the two on purpose.
      </p>
      <Button asChild>
        <Link href="/dashboard">Back to Mission Control</Link>
      </Button>
    </main>
  );
}
