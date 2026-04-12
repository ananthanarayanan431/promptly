import { AdvisoryResponse } from '@/types/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle2, XCircle, MessageSquareQuote } from 'lucide-react';

export function AdvisoryDisplay({ advisory }: { advisory: AdvisoryResponse }) {
  return (
    <Card className="shadow-sm overflow-hidden">
      <CardHeader className="pb-0 pt-5 px-5">
        <CardTitle className="text-base font-semibold">Advisory Review</CardTitle>
      </CardHeader>
      <CardContent className="p-5 space-y-5">

        {/* Overall assessment */}
        <div className="rounded-xl bg-muted/50 border p-4 flex gap-3">
          <MessageSquareQuote className="h-4 w-4 text-primary shrink-0 mt-0.5" />
          <p className="text-sm leading-relaxed text-foreground/80 italic">
            {advisory.overall_assessment}
          </p>
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
                {advisory.strengths.length}
              </span>
            </div>
            {advisory.strengths.length === 0 ? (
              <p className="text-sm text-muted-foreground italic pl-1">None identified.</p>
            ) : (
              <ul className="space-y-2.5">
                {advisory.strengths.map((item, idx) => (
                  <li key={idx} className="flex gap-2.5 border-l-2 border-green-500 pl-3 py-0.5">
                    <span className="text-sm leading-relaxed text-foreground">{item}</span>
                  </li>
                ))}
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
                {advisory.weaknesses.length}
              </span>
            </div>
            {advisory.weaknesses.length === 0 ? (
              <p className="text-sm text-muted-foreground italic pl-1">None identified.</p>
            ) : (
              <ul className="space-y-2.5">
                {advisory.weaknesses.map((item, idx) => (
                  <li key={idx} className="flex gap-2.5 border-l-2 border-red-500 pl-3 py-0.5">
                    <span className="text-sm leading-relaxed text-foreground">{item}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Improvements — timeline style */}
        {advisory.improvements.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Actionable Improvements
            </p>
            <ol className="space-y-0">
              {advisory.improvements.map((item, idx) => (
                <li key={idx} className="relative flex gap-4">
                  {/* Connector line */}
                  {idx < advisory.improvements.length - 1 && (
                    <div className="absolute left-[19px] top-10 bottom-0 w-px bg-border" />
                  )}
                  {/* Step number */}
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-amber-300 bg-amber-50 dark:bg-amber-900/30 dark:border-amber-700 text-amber-700 dark:text-amber-400 text-xs font-bold z-10 mt-0.5">
                    {String(idx + 1).padStart(2, '0')}
                  </div>
                  {/* Content */}
                  <div className={`flex-1 pt-2 ${idx < advisory.improvements.length - 1 ? 'pb-6' : 'pb-0'}`}>
                    <p className="text-sm leading-relaxed">{item}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}

      </CardContent>
    </Card>
  );
}
