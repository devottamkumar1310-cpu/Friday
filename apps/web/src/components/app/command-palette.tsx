'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  BarChart3,
  Brain,
  CalendarDays,
  ClipboardList,
  CreditCard,
  Database,
  Dumbbell,
  MessageCircle,
  Search,
  Settings,
  Target,
  TrendingUp,
  X,
} from 'lucide-react';

interface Command {
  id: string;
  label: string;
  icon: React.ElementType;
  href: string;
  group: string;
  keywords?: string[];
}

const COMMANDS: Command[] = [
  // MISSION
  { id: 'dashboard', label: 'Mission Control', icon: Target, href: '/dashboard', group: 'MISSION', keywords: ['home', 'mission', 'today'] },
  { id: 'plan', label: 'Plan', icon: CalendarDays, href: '/plan', group: 'MISSION', keywords: ['schedule', 'calendar', 'tasks'] },
  // LEARN
  { id: 'progress', label: 'Progress', icon: BarChart3, href: '/progress', group: 'LEARN', keywords: ['mastery', 'weak', 'concepts'] },
  { id: 'practice', label: 'Practice', icon: Dumbbell, href: '/practice', group: 'LEARN', keywords: ['practice', 'quiz', 'retrieval'] },
  { id: 'mock-test', label: 'Mock Test', icon: ClipboardList, href: '/mock-test', group: 'LEARN', keywords: ['mock', 'test', 'exam', 'full'] },
  { id: 'root-cause', label: 'Root Cause', icon: Brain, href: '/root-cause', group: 'LEARN', keywords: ['why', 'weak', 'prerequisite'] },
  { id: 'weekly-review', label: 'Weekly Review', icon: TrendingUp, href: '/weekly-review', group: 'LEARN', keywords: ['review', 'week', 'summary'] },
  // THINK
  { id: 'coach', label: 'Coach', icon: MessageCircle, href: '/coach', group: 'THINK', keywords: ['coach', 'chat', 'help', 'ask'] },
  { id: 'memory', label: 'Memory', icon: Database, href: '/memory', group: 'THINK', keywords: ['memory', 'beliefs', 'facts', 'review'] },
  // SYSTEM
  { id: 'settings', label: 'Settings', icon: Settings, href: '/settings', group: 'SYSTEM', keywords: ['preferences', 'account', 'timezone'] },
  { id: 'billing', label: 'Billing', icon: CreditCard, href: '/billing', group: 'SYSTEM', keywords: ['subscription', 'upgrade', 'pro', 'billing'] },
];

function groupCommands(filtered: Command[]) {
  const groups = new Map<string, Command[]>();
  for (const cmd of filtered) {
    const group = groups.get(cmd.group) ?? [];
    group.push(cmd);
    groups.set(cmd.group, group);
  }
  return groups;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const filtered = query.trim()
    ? COMMANDS.filter((c) => {
        const q = query.toLowerCase();
        return (
          c.label.toLowerCase().includes(q) ||
          c.group.toLowerCase().includes(q) ||
          c.keywords?.some((k) => k.includes(q))
        );
      })
    : COMMANDS;

  const flatFiltered = filtered;

  const navigate = useCallback(
    (href: string) => {
      setOpen(false);
      setQuery('');
      router.push(href);
    },
    [router]
  );

  // Keyboard shortcut to open
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // Arrow key navigation
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, flatFiltered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        const cmd = flatFiltered[activeIndex];
        if (cmd) navigate(cmd.href);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, flatFiltered, activeIndex, navigate]);

  if (!open) return null;

  const groups = groupCommands(filtered);
  let globalIndex = 0;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] px-4"
      onClick={() => setOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-overlay" />

      {/* Panel */}
      <div
        className="relative w-full max-w-xl rounded-xl border border-border bg-surface shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <Search className="size-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
            placeholder="Search pages and actions..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
          />
          {query && (
            <button onClick={() => setQuery('')} className="text-muted-foreground hover:text-foreground">
              <X className="size-4" />
            </button>
          )}
          <kbd className="hidden sm:inline-flex items-center gap-1 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto py-2">
          {filtered.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">No pages found for "{query}"</p>
          ) : (
            [...groups.entries()].map(([groupName, cmds]) => (
              <div key={groupName}>
                <p className="px-4 py-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  {groupName}
                </p>
                {cmds.map((cmd) => {
                  const isActive = globalIndex++ === activeIndex;
                  const Icon = cmd.icon;
                  return (
                    <button
                      key={cmd.id}
                      className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                        isActive
                          ? 'bg-primary/10 text-primary'
                          : 'text-foreground hover:bg-muted'
                      }`}
                      onMouseEnter={() => setActiveIndex(flatFiltered.indexOf(cmd))}
                      onClick={() => navigate(cmd.href)}
                    >
                      <Icon className="size-4 shrink-0" />
                      <span className="font-medium">{cmd.label}</span>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer hint */}
        <div className="border-t border-border px-4 py-2 flex items-center gap-4 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1"><kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono">↑↓</kbd> Navigate</span>
          <span className="flex items-center gap-1"><kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono">↵</kbd> Go</span>
          <span className="flex items-center gap-1"><kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono">⌘K</kbd> Toggle</span>
        </div>
      </div>
    </div>
  );
}
