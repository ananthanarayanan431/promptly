'use client';

import { useState } from 'react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { AnalyticsSeries } from '@/types/analytics';

function fmtVal(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  if (n < 1 && n > 0) return n.toFixed(2);
  return n.toLocaleString();
}

function shortDate(s: string): string {
  // "2026-06-23" → "23 Jun", "2026-06" → "Jun"
  // Use Date.UTC to avoid off-by-one day shifts in negative-offset timezones.
  if (s.length === 7) {
    const [y, m] = s.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1, 1));
    return d.toLocaleString('en', { month: 'short', timeZone: 'UTC' });
  }
  if (s.length >= 10) {
    const [y, m, day] = s.substring(0, 10).split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1, day));
    return `${d.getUTCDate()} ${d.toLocaleString('en', { month: 'short', timeZone: 'UTC' })}`;
  }
  return s;
}

interface Props {
  series: AnalyticsSeries;
  defaultChartType?: 'line' | 'bar';
  height?: number;
}

export function MetricCard({ series, defaultChartType, height = 120 }: Props) {
  const [chartType, setChartType] = useState<'line' | 'bar'>(defaultChartType ?? series.chart_type);
  const color = series.color ?? 'var(--primary)';
  const rechartData = series.data.map(p => ({ date: shortDate(p.date), value: p.value }));

  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 12, padding: '18px 20px', display: 'flex',
      flexDirection: 'column', gap: 8,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-subtle)',
          textTransform: 'uppercase', letterSpacing: '.07em' }}>
          {series.label}
        </span>
        {/* Line / Bar toggle */}
        <div style={{ display: 'flex', gap: 2, background: 'var(--surface-2)',
          borderRadius: 6, padding: 2 }}>
          {(['line', 'bar'] as const).map(t => (
            <button key={t} onClick={() => setChartType(t)} style={{
              padding: '2px 8px', fontSize: 10.5, fontWeight: 600,
              borderRadius: 4, border: 'none', cursor: 'pointer',
              background: chartType === t ? 'var(--surface)' : 'transparent',
              color: chartType === t ? 'var(--text)' : 'var(--text-muted)',
              boxShadow: chartType === t ? '0 1px 2px rgba(0,0,0,.08)' : 'none',
            }}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Big number */}
      <div style={{ fontFamily: 'var(--mono)', fontSize: 28, fontWeight: 700,
        color: 'var(--text)', lineHeight: 1 }}>
        {fmtVal(series.total)}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{series.time_range}</div>

      {/* Chart */}
      <div style={{ height, marginTop: 4 }}>
        <ResponsiveContainer width="100%" height="100%">
          {chartType === 'line' ? (
            <LineChart data={rechartData} margin={{ top: 2, right: 4, left: -24, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'var(--text-subtle)' }}
                tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 9, fill: 'var(--text-subtle)' }}
                tickLine={false} axisLine={false} />
              <Tooltip
                contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)',
                  borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: 'var(--text-muted)', marginBottom: 4 }}
                itemStyle={{ color: 'var(--text)' }}
              />
              <Line type="monotone" dataKey="value" stroke={color}
                strokeWidth={2} dot={false} activeDot={{ r: 4 }} name={series.label} />
            </LineChart>
          ) : (
            <BarChart data={rechartData} margin={{ top: 2, right: 4, left: -24, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'var(--text-subtle)' }}
                tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 9, fill: 'var(--text-subtle)' }}
                tickLine={false} axisLine={false} />
              <Tooltip
                contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)',
                  borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: 'var(--text-muted)', marginBottom: 4 }}
                itemStyle={{ color: 'var(--text)' }}
              />
              <Bar dataKey="value" fill={color} radius={[3, 3, 0, 0]} name={series.label} />
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
