'use client';

import { useState } from 'react';
import { Sidebar } from '@/components/layout/sidebar';
import { Header } from '@/components/layout/header';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [sidebarWidth, setSidebarWidth] = useState(248);

  return (
    <div style={{ display: 'flex', height: '100vh', background: '#141414', overflow: 'hidden' }}>
      <Sidebar width={sidebarWidth} onWidthChange={setSidebarWidth} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden', minWidth: 0 }}>
        <Header />
        <main style={{ flex: 1, overflow: 'hidden' }}>
          {children}
        </main>
      </div>
    </div>
  );
}
