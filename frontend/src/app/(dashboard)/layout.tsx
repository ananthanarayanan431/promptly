'use client';

import { Sidebar } from '@/components/layout/sidebar';
import { ClerkTokenSync } from '@/components/clerk-token-sync';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ClerkTokenSync />
      <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)' }}>
        <Sidebar />
        <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          {children}
        </main>
      </div>
    </>
  );
}
