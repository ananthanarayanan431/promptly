'use client';

import { Toaster as SonnerToaster } from '@/components/ui/sonner';

// Thin wrapper so we never edit the shadcn-generated ui/sonner.tsx directly.
export function Toaster() {
  return <SonnerToaster />;
}
