'use client';

import { ModelStats } from '@/types/api';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
} from 'recharts';

interface Props {
  data: ModelStats[];
}

const MODEL_COLORS: Record<string, string> = {
  'gpt-4o-mini': '#10b981',
  'claude-3.5-haiku': '#f59e0b',
  'gemini-2.0-flash': '#3b82f6',
  'grok-2': '#8b5cf6',
};
const DEFAULT_COLOR = '#6b7280';

function shortModel(model: string): string {
  const map: Record<string, string> = {
    'gpt-4o-mini': 'GPT-4o Mini',
    'claude-3.5-haiku': 'Claude Haiku',
    'gemini-2.0-flash': 'Gemini Flash',
    'grok-2': 'Grok-2',
  };
  return map[model] ?? model;
}

export function ModelChart({ data }: Props) {
  const formatted = data.map((d) => ({
    ...d,
    label: shortModel(d.model),
    color: MODEL_COLORS[d.model] ?? DEFAULT_COLOR,
  }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={formatted} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11 }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tick={{ fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v))}
        />
        <Tooltip
          contentStyle={{
            borderRadius: '8px',
            fontSize: '12px',
            border: '1px solid hsl(var(--border))',
            background: 'hsl(var(--popover))',
            color: 'hsl(var(--popover-foreground))',
          }}
          formatter={(value) => [Number(value).toLocaleString(), 'Tokens']}
        />
        <Bar dataKey="total_tokens" radius={[4, 4, 0, 0]}>
          {formatted.map((entry, index) => (
            <Cell key={index} fill={entry.color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
