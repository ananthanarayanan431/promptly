import { AdvisoryResponse } from '@/types/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle2, XCircle, MessageSquareQuote, LayoutGrid } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DIMENSION_LABELS, parseSeverity, parseDimensionScore } from '@/lib/advisory';

const SCORE_CLS: Record<string, string> = {
  STRONG:   'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  ADEQUATE: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  WEAK:     'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  MISSING:  'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};

const OVERALL_CLS: Record<string, string> = {
  HIGH:     'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  MODERATE: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  LOW:      'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};

const RISK_CLS: Record<string, string> = {
  NONE:     'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  LOW:      'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  MODERATE: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  HIGH:     'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};

const SEVERITY_CLS: Record<string, string> = {
  CRITICAL: 'border-l-red-500',
  MAJOR:    'border-l-amber-500',
  MINOR:    'border-l-blue-400',
};

const SEVERITY_BADGE: Record<string, string> = {
  CRITICAL: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  MAJOR:    'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  MINOR:    'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
};

export function AdvisoryDisplay({ advisory }: { advisory: AdvisoryResponse }) {
  const { meta, dimension_scores, strengths, weaknesses, improvements, overall_assessment } = advisory;

  return (
    <Card className="shadow-sm overflow-hidden">
      <CardHeader className="pb-0 pt-5 px-5">
        <CardTitle className="text-base font-semibold">Advisory Review</CardTitle>
      </CardHeader>
      <CardContent className="p-5 space-y-5">

        {/* Meta badges */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className={cn('text-xs font-bold px-2.5 py-0.5 rounded-full', OVERALL_CLS[meta.overall_score] ?? '')}>
            Overall: {meta.overall_score}
          </span>
          <span className={cn('text-xs font-semibold px-2.5 py-0.5 rounded-full', RISK_CLS[meta.injection_risk] ?? '')}>
            Injection risk: {meta.injection_risk}
          </span>
        </div>

        {/* Overall assessment */}
        <div className="rounded-xl bg-muted/50 border p-4 flex gap-3">
          <MessageSquareQuote className="h-4 w-4 text-primary shrink-0 mt-0.5" />
          <p className="text-sm leading-relaxed text-foreground/80 italic">
            {overall_assessment}
          </p>
        </div>

        {/* Dimension scores */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <LayoutGrid className="h-3.5 w-3.5" />
            Dimension Scores
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {(Object.keys(DIMENSION_LABELS) as (keyof typeof DIMENSION_LABELS)[]).map((key) => {
              const raw = dimension_scores[key as keyof typeof dimension_scores] ?? '';
              const { label, explanation } = parseDimensionScore(raw);
              return (
                <div key={key} className="rounded-lg border bg-card p-3 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-foreground/80">{DIMENSION_LABELS[key]}</span>
                    <span className={cn('text-xs font-bold px-2 py-0.5 rounded-full shrink-0', SCORE_CLS[label] ?? 'bg-muted text-muted-foreground')}>
                      {label}
                    </span>
                  </div>
                  {explanation && (
                    <p className="text-xs text-muted-foreground leading-relaxed">{explanation}</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Strengths + Weaknesses side by side */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Strengths */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <span className="text-sm font-semibold text-green-700 dark:text-green-400">
                Strengths
              </span>
              <span className="ml-auto text-xs bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-2 py-0.5 rounded-full font-medium">
                {strengths.length}
              </span>
            </div>
            {strengths.length === 0 ? (
              <p className="text-sm text-muted-foreground italic pl-1">None identified.</p>
            ) : (
              <ul className="space-y-2.5">
                {strengths.map((item, idx) => {
                  const { text } = parseSeverity(item);
                  return (
                    <li key={idx} className="flex gap-2.5 border-l-2 border-green-500 pl-3 py-0.5">
                      <span className="text-sm leading-relaxed text-foreground">{text}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Weaknesses */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <XCircle className="h-4 w-4 text-red-500" />
              <span className="text-sm font-semibold text-red-700 dark:text-red-400">
                Weaknesses
              </span>
              <span className="ml-auto text-xs bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400 px-2 py-0.5 rounded-full font-medium">
                {weaknesses.length}
              </span>
            </div>
            {weaknesses.length === 0 ? (
              <p className="text-sm text-muted-foreground italic pl-1">None identified.</p>
            ) : (
              <ul className="space-y-2.5">
                {weaknesses.map((item, idx) => {
                  const { severity, text } = parseSeverity(item);
                  return (
                    <li key={idx} className={cn('flex flex-col gap-1 border-l-2 pl-3 py-0.5', SEVERITY_CLS[severity ?? ''] ?? 'border-l-red-500')}>
                      {severity && (
                        <span className={cn('text-xs font-bold self-start px-1.5 py-0.5 rounded', SEVERITY_BADGE[severity])}>
                          {severity}
                        </span>
                      )}
                      <span className="text-sm leading-relaxed text-foreground">{text}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* Improvements — timeline style */}
        {improvements.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Actionable Improvements
            </p>
            <ol className="space-y-0">
              {improvements.map((item, idx) => {
                const { severity, text } = parseSeverity(item);
                return (
                  <li key={idx} className="relative flex gap-4">
                    {idx < improvements.length - 1 && (
                      <div className="absolute left-[19px] top-10 bottom-0 w-px bg-border" />
                    )}
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-amber-300 bg-amber-50 dark:bg-amber-900/30 dark:border-amber-700 text-amber-700 dark:text-amber-400 text-xs font-bold z-10 mt-0.5">
                      {String(idx + 1).padStart(2, '0')}
                    </div>
                    <div className={`flex-1 pt-2 ${idx < improvements.length - 1 ? 'pb-6' : 'pb-0'}`}>
                      {severity && (
                        <span className={cn('text-xs font-bold px-1.5 py-0.5 rounded mr-1.5', SEVERITY_BADGE[severity])}>
                          {severity}
                        </span>
                      )}
                      <span className="text-sm leading-relaxed">{text}</span>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        )}

      </CardContent>
    </Card>
  );
}
