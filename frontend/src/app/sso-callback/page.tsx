'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Legacy SSO callback page — OAuth redirects now handled by /auth/callback.
 * Kept for backwards compatibility; immediately hands off to the new route.
 */
export default function SSOCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    // Forward any query params (e.g. ?code=...) to the new OAuth callback handler.
    router.replace(`/auth/callback${window.location.search}`);
  }, [router]);

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'var(--font-geist), ui-sans-serif, system-ui, sans-serif',
        fontSize: 14,
        color: 'var(--muted-foreground, #888)',
      }}
    >
      Signing you in…
    </div>
  );
}
