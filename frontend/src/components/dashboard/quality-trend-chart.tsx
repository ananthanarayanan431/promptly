'use client';

import type { QualityTrendPoint } from '@/types/api';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from 'recharts';
import { format, parseISO } from 'date-fns';

interface Props {
  data: QualityTrendPoint[];
}

export function QualityTrendChart({ data }: Props) {
  const formatted = data.map((d) => ({
    ...d,
    label: format(parseISO(d.date), 'MMM d'),
  }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={formatted} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          interval={4}
        />
        <YAxis
          domain={[0, 10]}
          ticks={[0, 2, 4, 6, 8, 10]}
          tick={{ fontSize: 11 }}
          tickLine={false}
          axisLine={false}
        />
        <ReferenceLine y={7} stroke="rgba(124,92,255,0.25)" strokeDasharray="4 3" />
        <Tooltip
          contentStyle={{
            borderRadius: '8px',
            fontSize: '12px',
            border: '1px solid hsl(var(--border))',
            background: 'hsl(var(--popover))',
            color: 'hsl(var(--popover-foreground))',
          }}
          formatter={(value) => [`${value} / 10`, 'Avg quality score']}
        />
        <Line
          type="monotone"
          dataKey="avg_score"
          strokeWidth={2}
          dot={{ r: 3, fill: '#7c5cff' }}
          activeDot={{ r: 5 }}
          stroke="#7c5cff"
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
