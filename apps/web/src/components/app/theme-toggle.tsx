'use client';

import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@friday/ui';

/**
 * Light / dark switch.
 *
 * The dark palette has existed since Phase 0 — twenty-three token overrides
 * under `.dark` — and the root layout has always read `friday-theme` from
 * `localStorage` before first paint to avoid a flash of the wrong theme.
 *
 * Nothing ever wrote that key. Settings offered a Light/Dark/System control
 * that saved to the database and changed nothing on screen: a preference the
 * product recorded and then ignored. This is the missing half.
 *
 * `applyTheme` is exported so the settings form can share it and stop lying.
 */

export type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'friday-theme';

/** Writes the preference and applies it immediately, in that order. */
export function applyTheme(mode: ThemeMode): void {
  if (typeof window === 'undefined') return;

  try {
    // `system` removes the key so the layout's pre-paint script falls back to
    // the OS preference, rather than pinning whatever it resolves to today.
    if (mode === 'system') window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Private browsing or a full quota. The class below still applies for this
    // page view; only persistence is lost.
  }

  const dark =
    mode === 'dark' ||
    (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}

export function ThemeToggle() {
  // Starts undefined and resolves after mount: reading `localStorage` during
  // render would disagree with the server-rendered HTML and trip hydration.
  const [dark, setDark] = useState<boolean | null>(null);

  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));
  }, []);

  function toggle() {
    const next: ThemeMode = dark ? 'light' : 'dark';
    applyTheme(next);
    setDark(!dark);
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={toggle}
      // Stable label before mount, so the button is never briefly mislabelled.
      aria-label={dark === null ? 'Switch theme' : dark ? 'Switch to light' : 'Switch to dark'}
      className="size-9 p-0"
    >
      {dark ? <Moon className="size-4" aria-hidden /> : <Sun className="size-4" aria-hidden />}
    </Button>
  );
}
