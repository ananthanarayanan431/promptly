'use client';

import { useState } from 'react';
import { StatsCards } from '@/components/admin/stats-cards';
import { UsersTable } from '@/components/admin/users-table';
import { RateLimitsTable } from '@/components/admin/rate-limits-table';
import { ErrorsTable } from '@/components/admin/errors-table';

type Tab = 'overview' | 'users' | 'rate-limits' | 'errors';

const TABS: { id: Tab; label: string; icon: string; desc: string }[] = [
  { id: 'overview',    label: 'Overview',    icon: '📊', desc: 'Platform KPIs, usage trends, top consumers' },
  { id: 'users',       label: 'Users',       icon: '👥', desc: 'All accounts, token balances, admin controls' },
  { id: 'rate-limits', label: 'Rate Limits', icon: '⚡', desc: 'Live Redis counters, endpoint pressure' },
  { id: 'errors',      label: 'Errors',      icon: '🐛', desc: 'GlitchTip issues, occurrences, status' },
];

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<Tab>('overview');

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Page header */}
      <div style={{ padding: '24px 32px 0', background: 'var(--bg)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', margin: 0, letterSpacing: '-.01em' }}>
              Admin Panel
            </h1>
            <p style={{ fontSize: 13.5, color: 'var(--text-muted)', margin: '4px 0 0' }}>
              Application management, monitoring, and user operations
            </p>
          </div>
          <span style={{ fontSize: 11.5, padding: '4px 10px', borderRadius: 99, background: 'color-mix(in oklab, var(--danger) 10%, transparent)', color: 'var(--danger)', fontWeight: 700, border: '1px solid color-mix(in oklab, var(--danger) 25%, transparent)' }}>
            🔒 Admin only
          </span>
        </div>

        {/* Tab bar */}
        <div style={{ display: 'flex', gap: 0 }}>
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              title={tab.desc}
              style={{
                padding: '10px 18px',
                fontSize: 13.5,
                fontWeight: activeTab === tab.id ? 600 : 400,
                color: activeTab === tab.id ? 'var(--text)' : 'var(--text-muted)',
                background: 'transparent',
                border: 'none',
                borderBottom: activeTab === tab.id ? '2px solid var(--primary)' : '2px solid transparent',
                cursor: 'pointer',
                marginBottom: -1,
                transition: 'color .12s',
                display: 'flex', alignItems: 'center', gap: 7,
                whiteSpace: 'nowrap',
              }}
            >
              <span style={{ fontSize: 15 }}>{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab description bar */}
      <div style={{ padding: '10px 32px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
          {TABS.find(t => t.id === activeTab)?.desc}
        </span>
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px 60px' }}>
        {activeTab === 'overview'    && <StatsCards />}
        {activeTab === 'users'       && <UsersTable />}
        {activeTab === 'rate-limits' && <RateLimitsTable />}
        {activeTab === 'errors'      && <ErrorsTable />}
      </div>
    </div>
  );
}
