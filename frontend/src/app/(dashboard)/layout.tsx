import { Sidebar } from '@/components/layout/sidebar';
import { Header } from '@/components/layout/header';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '248px 1fr', height: '100vh',
      background: '#141414', overflow: 'hidden' }}>
      <Sidebar />
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        <Header />
        <main style={{ flex: 1, overflow: 'hidden' }}>
          {children}
        </main>
      </div>
    </div>
  );
}
