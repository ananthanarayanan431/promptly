'use client';

import { useState } from 'react';
import { StatsCards } from '@/components/admin/stats-cards';
import { UsersTable } from '@/components/admin/users-table';
import { RateLimitsTable } from '@/components/admin/rate-limits-table';
import { ErrorsTable } from '@/components/admin/errors-table';

type Tab = 'overview' | 'users' | 'rate-limits' | 'errors';

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'users', label: 'Users' },
  { id: 'rate-limits', label: 'Rate Limits' },
  { id: 'errors', label: 'Errors' },
];

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<Tab>('overview');

  return (
    <div style={{ padding: '32px 40px', maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', margin: 0 }}>Admin Panel</h1>
        <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: '6px 0 0' }}>
          Application management and monitoring
        </p>
      </div>

      {/* Tab bar */}
      <div style={{
        display: 'flex', gap: 2, marginBottom: 28,
        borderBottom: '1px solid var(--border)', paddingBottom: 0,
      }}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: activeTab === tab.id ? 600 : 400,
              color: activeTab === tab.id ? 'var(--text)' : 'var(--text-muted)',
              background: 'transparent',
              border: 'none',
              borderBottom: activeTab === tab.id ? '2px solid var(--primary)' : '2px solid transparent',
              cursor: 'pointer',
              marginBottom: -1,
              transition: 'color .12s',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'overview' && <StatsCards />}
      {activeTab === 'users' && <UsersTable />}
      {activeTab === 'rate-limits' && <RateLimitsTable />}
      {activeTab === 'errors' && <ErrorsTable />}
    </div>
  );
}
