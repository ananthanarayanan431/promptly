'use client';

import { useState } from 'react';
import { HealthScoreResponse, MetricScore } from '@/types/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

const METRIC_KEYS: { key: keyof Omit<HealthScoreResponse, 'prompt' | 'overall_score'>; label: string; desc: string }[] = [
  { key: 'clarity',         label: 'Clarity',         desc: 'Unambiguous instructions' },
  { key: 'specificity',     label: 'Specificity',     desc: 'Precision of constraints' },
  { key: 'completeness',    label: 'Completeness',    desc: 'Sufficient context provided' },
  { key: 'conciseness',     label: 'Conciseness',     desc: 'No filler or redundancy' },
  { key: 'tone',            label: 'Tone',            desc: 'Register fit for task' },
  { key: 'actionability',   label: 'Actionability',   desc: 'Ready to execute now' },
  { key: 'context_richness',label: 'Context Richness',desc: 'Background & audience clarity' },
  { key: 'goal_alignment',  label: 'Goal Alignment',  desc: 'Consistent objectives' },
];

type Tier = 'good' | 'medium' | 'poor';

function getTier(score: number): Tier {
  if (score >= 7.5) return 'good';
  if (score >= 5) return 'medium';
  return 'poor';
}

const TIER = {
  good:   { ring: '#22c55e', bar: 'bg-green-500',  text: 'text-green-600 dark:text-green-400',  label: 'Strong',   labelCls: 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
  medium: { ring: '#f59e0b', bar: 'bg-amber-500',  text: 'text-amber-600 dark:text-amber-400',  label: 'Moderate', labelCls: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  poor:   { ring: '#ef4444', bar: 'bg-red-500',    text: 'text-red-600 dark:text-red-400',      label: 'Weak',     labelCls: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
};

// Circumference for r=38: 2π×38 ≈ 238.76
const CIRC = 238.76;

function ScoreRing({ score, tier }: { score: number; tier: Tier }) {
  const filled = (score / 10) * CIRC;
  const color = TIER[tier].ring;
  return (
    <div className="relative w-28 h-28 shrink-0">
      <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
        <circle cx="50" cy="50" r="38" fill="none" strokeWidth="10"
          className="stroke-muted" />
        <circle cx="50" cy="50" r="38" fill="none" strokeWidth="10"
          stroke={color}
          strokeDasharray={`${filled} ${CIRC}`}
          strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 0.6s ease' }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={cn('text-2xl font-black leading-none', TIER[tier].text)}>
          {score.toFixed(1)}
        </span>
        <span className="text-xs text-muted-foreground">/10</span>
      </div>
    </div>
  );
}

function DimensionCard({ label, desc, metric }: { label: string; desc: string; metric: MetricScore }) {
  const [open, setOpen] = useState(false);
  const tier = getTier(metric.score);
  const t = TIER[tier];

  return (
    <button
      onClick={() => setOpen((v) => !v)}
      className="w-full text-left rounded-xl border bg-card hover:bg-muted/40 transition-colors p-3.5 space-y-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-center gap-2.5">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{label}</p>
          <p className="text-xs text-muted-foreground truncate">{desc}</p>
        </div>
        <span className={cn('text-xs font-bold px-2 py-0.5 rounded-full shrink-0', t.labelCls)}>
          {metric.score}/10
        </span>
        <ChevronDown className={cn('h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform', open && 'rotate-180')} />
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all duration-500', t.bar)}
          style={{ width: `${metric.score * 10}%` }}
        />
      </div>
      {open && (
        <p className="text-xs text-muted-foreground leading-relaxed border-t pt-2.5 text-left">
          {metric.rationale}
        </p>
      )}
    </button>
  );
}

export function ScoreDisplay({ score }: { score: HealthScoreResponse }) {
  const tier = getTier(score.overall_score);
  const t = TIER[tier];
  const aboveAvg = METRIC_KEYS.filter((m) => score[m.key].score >= 7.5).length;
  const belowAvg = METRIC_KEYS.filter((m) => score[m.key].score < 5).length;

  return (
    <Card className="shadow-sm overflow-hidden">
      <CardHeader className="pb-0 pt-5 px-5">
        <CardTitle className="text-base font-semibold">Health Score</CardTitle>
      </CardHeader>
      <CardContent className="p-5 space-y-5">

        {/* Hero: ring + summary */}
        <div className="flex items-center gap-5 rounded-xl bg-muted/40 p-4">
          <ScoreRing score={score.overall_score} tier={tier} />
          <div className="space-y-1.5 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={cn('text-sm font-bold px-2.5 py-0.5 rounded-full', t.labelCls)}>
                {t.label} quality
              </span>
            </div>
            <p className="text-sm text-muted-foreground leading-snug">
              {aboveAvg} of 8 dimensions score 7.5 or higher.
              {belowAvg > 0 && ` ${belowAvg} dimension${belowAvg > 1 ? 's' : ''} need attention.`}
            </p>
            <div className="flex gap-3 pt-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
                Strong ≥7.5
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full bg-amber-500" />
                Moderate ≥5
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full bg-red-500" />
                Weak &lt;5
              </span>
            </div>
          </div>
        </div>

        {/* 2-column dimension grid */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            Dimension Breakdown — click any card to read the rationale
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {METRIC_KEYS.map(({ key, label, desc }) => (
              <DimensionCard key={key} label={label} desc={desc} metric={score[key]} />
            ))}
          </div>
        </div>

      </CardContent>
    </Card>
  );
}
