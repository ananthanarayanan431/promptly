'use client';

import { useAuth } from '@clerk/nextjs';
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Sidebar } from '@/components/layout/sidebar';
import { setAuthToken } from '@/lib/api';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { getToken, isSignedIn, isLoaded } = useAuth();
  const [ready, setReady] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setAuthToken(null);
      // Not signed in — redirect to sign-in rather than rendering children
      window.location.href = '/sign-in';
      return;
    }
    getToken().then((token) => {
      console.log('[DashboardLayout] getToken result:', token ? `${token.slice(0, 20)}...` : null);
      if (!token) {
        // Signed in but no token yet (session initializing) — retry once
        return getToken().then((retryToken) => {
          console.log('[DashboardLayout] retry getToken result:', retryToken ? `${retryToken.slice(0, 20)}...` : null);
          setAuthToken(retryToken);
          queryClient.clear();
          setReady(true);
        });
      }
      setAuthToken(token);
      queryClient.clear();
      setReady(true);
    });

    const interval = setInterval(async () => {
      const token = await getToken();
      if (token) setAuthToken(token);
    }, 50_000);
    return () => clearInterval(interval);
  }, [isLoaded, isSignedIn, getToken, queryClient]);

  if (!ready) return null;

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)' }}>
      <Sidebar />
      <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {children}
      </main>
    </div>
  );
}
