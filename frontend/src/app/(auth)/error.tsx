'use client';

import { useEffect } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import Link from 'next/link';

export default function AuthError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[AuthError]', error);
  }, [error]);

  return (
    <div className="space-y-6 text-center">
      <div className="inline-flex items-center justify-center h-12 w-12 rounded-full bg-destructive/10 mx-auto">
        <AlertCircle className="h-6 w-6 text-destructive" />
      </div>
      <div className="space-y-2">
        <h2 className="text-lg font-semibold text-foreground">Something went wrong</h2>
        <p className="text-sm text-muted-foreground">
          An error occurred during authentication. Please try again.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={reset}
          className="w-full inline-flex items-center justify-center gap-2 h-10 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <RefreshCw className="h-4 w-4" />
          Try again
        </button>
        <Link
          href="/login"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Back to login
        </Link>
      </div>
    </div>
  );
}
