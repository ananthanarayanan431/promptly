'use client';

import { useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

function readStoredTheme(): Theme | null {
  try {
    const stored = localStorage.getItem('ply-theme') as Theme | null;
    if (stored === 'light' || stored === 'dark') return stored;
  } catch { /* private/restricted context */ }
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : null;
}

export function useTheme() {
  // Always start with 'dark' so server and first client render match.
  // The real value is applied after mount via useEffect.
  const [theme, setThemeState] = useState<Theme>('dark');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const actual = readStoredTheme() ?? 'dark';
    setThemeState(actual);
    document.documentElement.dataset.theme = actual;
    setMounted(true);
  }, []);

  const setTheme = (next: Theme) => {
    setThemeState(next);
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('ply-theme', next); } catch { /* private/restricted context */ }
  };

  const toggle = () => setTheme(theme === 'dark' ? 'light' : 'dark');

  return { theme, toggle, mounted };
}
