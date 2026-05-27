'use client';

import { AuthenticateWithRedirectCallback } from '@clerk/nextjs';

/**
 * Lands here after an OAuth redirect. The Clerk component finishes the handshake
 * and forwards to /optimize. It renders nothing, so we show a minimal placeholder.
 */
export default function SSOCallbackPage() {
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
      <AuthenticateWithRedirectCallback
        signInForceRedirectUrl="/optimize"
        signUpForceRedirectUrl="/optimize"
      />
    </div>
  );
}
