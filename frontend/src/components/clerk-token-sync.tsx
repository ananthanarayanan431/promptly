'use client';
import { useAuth } from '@clerk/nextjs';
import { useEffect } from 'react';
import { setAuthToken } from '@/lib/api';

export function ClerkTokenSync() {
  const { getToken, isSignedIn } = useAuth();

  useEffect(() => {
    if (!isSignedIn) {
      setAuthToken(null);
      return;
    }
    getToken().then((token) => setAuthToken(token));
    // Refresh token every 50s (Clerk tokens expire in 60s)
    const interval = setInterval(async () => {
      const token = await getToken();
      setAuthToken(token);
    }, 50_000);
    return () => clearInterval(interval);
  }, [isSignedIn, getToken]);

  return null;
}
