'use client';

import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

const PHASES = [
  'Reading your prompt...',
  'Generating optimized versions...',
  'Evaluating and comparing results...',
  'Selecting the strongest outcome...',
  'Preparing your optimized prompt...',
];

export function LoadingWords() {
  const [idx, setIdx] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setIdx((prev) => (prev + 1) % PHASES.length);
        setVisible(true);
      }, 300);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="space-y-3 py-1">
      <div className="flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
        <span
          className="text-sm text-muted-foreground transition-opacity duration-300"
          style={{ opacity: visible ? 1 : 0 }}
        >
          {PHASES[idx]}
        </span>
      </div>
      <div className="space-y-2 pl-6">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-[82%]" />
        <Skeleton className="h-3 w-[65%]" />
        <Skeleton className="h-8 w-full mt-2" />
      </div>
    </div>
  );
}
