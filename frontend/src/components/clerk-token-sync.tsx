'use client';
import { useAuth } from '@clerk/nextjs';
import { useEffect } from 'react';
import { setAuthToken } from '@/lib/api';

export function ClerkTokenSync() {
  const { getToken, isSignedIn } = useAuth();

  // Set token immediately on every render when signed in
  // This runs synchronously before child components fire their API calls
  useEffect(() => {
    if (!isSignedIn) {
      setAuthToken(null);
      return;
    }

    // Fetch and set token immediately
    let cancelled = false;
    getToken().then((token) => {
      if (!cancelled) setAuthToken(token);
    });

    // Refresh every 50s before the 60s Clerk expiry
    const interval = setInterval(async () => {
      const token = await getToken();
      if (!cancelled) setAuthToken(token);
    }, 50_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isSignedIn, getToken]);

  return null;
}
