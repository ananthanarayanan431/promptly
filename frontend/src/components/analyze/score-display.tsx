'use client';

import { useState } from 'react';
import { HealthScoreResponse, HealthScores } from '@/types/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChevronDown, AlertTriangle, Rocket, ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

const METRIC_KEYS: { key: keyof HealthScores; label: string; desc: string }[] = [
  { key: 'clarity',              label: 'Clarity',              desc: 'Unambiguous instructions' },
  { key: 'specificity',          label: 'Specificity',          desc: 'Precision of constraints' },
  { key: 'completeness',         label: 'Completeness',         desc: 'Sufficient context provided' },
  { key: 'conciseness',          label: 'Conciseness',          desc: 'No filler or redundancy' },
  { key: 'tone',                 label: 'Tone',                 desc: 'Register fit for task' },
  { key: 'actionability',        label: 'Actionability',        desc: 'Ready to execute now' },
  { key: 'context_richness',     label: 'Context Richness',     desc: 'Background & audience clarity' },
  { key: 'goal_alignment',       label: 'Goal Alignment',       desc: 'Consistent objectives' },
  { key: 'injection_robustness', label: 'Injection Robustness', desc: 'Resistant to hostile inputs' },
  { key: 'reusability',          label: 'Reusability',          desc: 'Easy to maintain & template' },
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

const GRADE_CLS: Record<string, string> = {
  A: 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  B: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  C: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  D: 'bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  F: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};

const RISK_CLS: Record<string, string> = {
  NONE:     'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  LOW:      'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  MODERATE: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  HIGH:     'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400',
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

function DimensionCard({ label, desc, metric }: { label: string; desc: string; metric: { score: number; rationale: string } }) {
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
  const { meta, scores, critical_failures, top_improvements, deploy_verdict } = score;
  const tier = getTier(meta.overall_score);
  const t = TIER[tier];
  const aboveAvg = METRIC_KEYS.filter((m) => scores[m.key].score >= 7.5).length;
  const belowAvg = METRIC_KEYS.filter((m) => scores[m.key].score < 5).length;

  return (
    <Card className="shadow-sm overflow-hidden">
      <CardHeader className="pb-0 pt-5 px-5">
        <CardTitle className="text-base font-semibold">Health Score</CardTitle>
      </CardHeader>
      <CardContent className="p-5 space-y-5">

        {/* Hero: ring + summary */}
        <div className="flex items-center gap-5 rounded-xl bg-muted/40 p-4">
          <ScoreRing score={meta.overall_score} tier={tier} />
          <div className="space-y-1.5 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={cn('text-sm font-bold px-2.5 py-0.5 rounded-full', t.labelCls)}>
                {t.label} quality
              </span>
              <span className={cn('text-xs font-bold px-2.5 py-0.5 rounded-full', GRADE_CLS[meta.grade] ?? '')}>
                Grade {meta.grade}
              </span>
              <span className={cn('text-xs font-semibold px-2.5 py-0.5 rounded-full', RISK_CLS[meta.injection_risk] ?? '')}>
                Injection: {meta.injection_risk}
              </span>
              {meta.deploy_ready ? (
                <span className="flex items-center gap-1 text-xs font-semibold px-2.5 py-0.5 rounded-full bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                  <Rocket className="h-3 w-3" /> Deploy ready
                </span>
              ) : (
                <span className="flex items-center gap-1 text-xs font-semibold px-2.5 py-0.5 rounded-full bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                  <ShieldAlert className="h-3 w-3" /> Not ready
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground leading-snug">
              {aboveAvg} of 10 dimensions score 7.5 or higher.
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
              <DimensionCard key={key} label={label} desc={desc} metric={scores[key]} />
            ))}
          </div>
        </div>

        {/* Critical failures */}
        {critical_failures.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
              Critical Failures
            </p>
            <ul className="space-y-2">
              {critical_failures.map((item, idx) => (
                <li key={idx} className="flex gap-2.5 rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50/50 dark:bg-red-900/10 px-3 py-2">
                  <span className="text-xs leading-relaxed text-red-700 dark:text-red-400">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Top improvements */}
        {top_improvements.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Top Improvements
            </p>
            <ol className="space-y-0">
              {top_improvements.map((item, idx) => (
                <li key={idx} className="relative flex gap-4">
                  {idx < top_improvements.length - 1 && (
                    <div className="absolute left-[19px] top-10 bottom-0 w-px bg-border" />
                  )}
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-amber-300 bg-amber-50 dark:bg-amber-900/30 dark:border-amber-700 text-amber-700 dark:text-amber-400 text-xs font-bold z-10 mt-0.5">
                    {String(idx + 1).padStart(2, '0')}
                  </div>
                  <div className={`flex-1 pt-2 ${idx < top_improvements.length - 1 ? 'pb-6' : 'pb-0'}`}>
                    <p className="text-sm leading-relaxed">{item}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* Deploy verdict */}
        {deploy_verdict && (
          <div className="rounded-xl bg-muted/50 border p-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Deploy Verdict</p>
            <p className="text-sm leading-relaxed text-foreground/80">{deploy_verdict}</p>
          </div>
        )}

      </CardContent>
    </Card>
  );
}
