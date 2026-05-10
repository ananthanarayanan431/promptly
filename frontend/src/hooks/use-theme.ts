'use client';

import { useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  const stored = localStorage.getItem('ply-theme') as Theme | null;
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const setTheme = (next: Theme) => {
    setThemeState(next);
    document.documentElement.dataset.theme = next;
    localStorage.setItem('ply-theme', next);
  };

  const toggle = () => setTheme(theme === 'dark' ? 'light' : 'dark');

  return { theme, toggle };
}
