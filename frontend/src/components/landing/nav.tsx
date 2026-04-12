'use client';

import Link from 'next/link';
import { Sparkles, Menu, X } from 'lucide-react';
import { ThemeToggle } from './theme-toggle';
import { useState } from 'react';

export function LandingNav() {
  const [open, setOpen] = useState(false);

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 pointer-events-none">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-4 pointer-events-auto">
        <div className="rounded-2xl border border-border/70 bg-background/75 dark:bg-background/65 backdrop-blur-xl shadow-lg shadow-black/[0.04] dark:shadow-black/30 ring-1 ring-black/[0.03] dark:ring-white/[0.06]">
      <div className="px-4 sm:px-5 h-14 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 font-bold text-lg shrink-0">
          <Sparkles className="h-5 w-5 text-violet-500" />
          <span>Promptly</span>
        </Link>

        {/* Desktop links */}
        <div className="hidden md:flex items-center gap-8 text-sm text-muted-foreground">
          <a href="#ideas" className="hover:text-foreground transition-colors">Ideas</a>
          <a href="#features" className="hover:text-foreground transition-colors">Features</a>
          <a href="#how-it-works" className="hover:text-foreground transition-colors">How it works</a>
          <a href="#council" className="hover:text-foreground transition-colors">The Council</a>
        </div>

        {/* Desktop actions */}
        <div className="hidden md:flex items-center gap-3">
          <ThemeToggle />
          <Link
            href="/login"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors px-3 py-2"
          >
            Sign in
          </Link>
          <Link
            href="/register"
            className="text-sm font-semibold px-4 py-2 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white transition-all shadow-sm shadow-violet-500/20"
          >
            Get started
          </Link>
        </div>

        {/* Mobile actions */}
        <div className="md:hidden flex items-center gap-2">
          <ThemeToggle />
          <button
            onClick={() => setOpen(!open)}
            className="p-2 rounded-lg hover:bg-muted transition-colors"
            aria-label="Toggle menu"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {open && (
        <div className="md:hidden border-t border-border bg-background/95 backdrop-blur-md px-6 py-4 flex flex-col gap-1">
          <a
            href="#ideas"
            className="text-sm text-muted-foreground hover:text-foreground py-2.5 px-3 rounded-lg hover:bg-muted transition-colors"
            onClick={() => setOpen(false)}
          >
            Ideas
          </a>
          <a
            href="#features"
            className="text-sm text-muted-foreground hover:text-foreground py-2.5 px-3 rounded-lg hover:bg-muted transition-colors"
            onClick={() => setOpen(false)}
          >
            Features
          </a>
          <a
            href="#how-it-works"
            className="text-sm text-muted-foreground hover:text-foreground py-2.5 px-3 rounded-lg hover:bg-muted transition-colors"
            onClick={() => setOpen(false)}
          >
            How it works
          </a>
          <a
            href="#council"
            className="text-sm text-muted-foreground hover:text-foreground py-2.5 px-3 rounded-lg hover:bg-muted transition-colors"
            onClick={() => setOpen(false)}
          >
            The Council
          </a>
          <div className="border-t border-border mt-3 pt-4 flex flex-col gap-3">
            <Link
              href="/login"
              className="text-sm text-center py-2.5 rounded-lg border border-border hover:bg-muted transition-colors"
            >
              Sign in
            </Link>
            <Link
              href="/register"
              className="text-sm font-semibold text-center py-2.5 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 text-white"
            >
              Get started free
            </Link>
          </div>
        </div>
      )}
        </div>
      </div>
    </nav>
  );
}
