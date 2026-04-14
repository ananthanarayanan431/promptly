'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { HealthScoreResponse, AdvisoryResponse } from '@/types/api';
import { ScoreDisplay } from '@/components/analyze/score-display';
import { AdvisoryDisplay } from '@/components/analyze/advisory-display';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ActivitySquare, Lightbulb, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const MAX_CHARS = 8000;

export default function AnalyzePage() {
  const [prompt, setPrompt] = useState('');
  const [healthScore, setHealthScore] = useState<HealthScoreResponse | null>(null);
  const [advisory, setAdvisory] = useState<AdvisoryResponse | null>(null);
  const [loadingHealth, setLoadingHealth] = useState(false);
  const [loadingAdvisory, setLoadingAdvisory] = useState(false);

  const handleHealthScore = async () => {
    if (!prompt.trim()) { toast.error('Paste a prompt first'); return; }
    setLoadingHealth(true);
    try {
      const res = await api.post<{ data: HealthScoreResponse }>('/api/v1/prompts/health-score', { prompt });
      setHealthScore(res.data.data);
    } catch {
      toast.error('Health score failed — check the server logs');
    } finally {
      setLoadingHealth(false);
    }
  };

  const handleAdvisory = async () => {
    if (!prompt.trim()) { toast.error('Paste a prompt first'); return; }
    setLoadingAdvisory(true);
    try {
      const res = await api.post<{ data: AdvisoryResponse }>('/api/v1/prompts/advisory', { prompt });
      setAdvisory(res.data.data);
    } catch {
      toast.error('Advisory failed — check the server logs');
    } finally {
      setLoadingAdvisory(false);
    }
  };

  const charCount = prompt.length;
  const isAnyLoading = loadingHealth || loadingAdvisory;
  const hasResults = healthScore || advisory;

  return (
    <div className="flex flex-col h-full">
      {/* ── Results area (scrollable top section) ── */}
      <div className="flex-1 overflow-y-auto">
        {!hasResults ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center h-full px-4 pb-4 text-center">
            <div className="space-y-2">
              <h1 className="text-2xl font-semibold tracking-tight">Prompt Analyzer</h1>
              <p className="text-sm text-muted-foreground max-w-sm">
                Paste a prompt below and run a Health Score or Advisory review. Each analysis costs 5 credits.
              </p>
            </div>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
            {healthScore && <ScoreDisplay score={healthScore} />}
            {advisory && <AdvisoryDisplay advisory={advisory} />}
          </div>
        )}
      </div>

      {/* ── Input area (sticky bottom) ── */}
      <div className="shrink-0 px-4 py-4 bg-gradient-to-t from-background via-background to-transparent">
        <div className="max-w-2xl mx-auto">
          <div className="rounded-2xl border bg-background shadow-sm focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary/40 transition-shadow">
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Paste the prompt you want to analyze…"
              className="min-h-[100px] resize-none text-sm leading-relaxed rounded-b-none border-0 focus-visible:ring-0 shadow-none bg-transparent"
              maxLength={MAX_CHARS}
            />
            <div className="flex items-center justify-between px-3 py-2.5 border-t">
              <span className={cn(
                'text-xs tabular-nums font-mono',
                charCount > MAX_CHARS * 0.9 ? 'text-destructive font-semibold' : 'text-muted-foreground/60'
              )}>
                {charCount.toLocaleString()} / {MAX_CHARS.toLocaleString()} chars
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleHealthScore}
                  disabled={isAnyLoading || !prompt.trim()}
                  className="gap-1.5 h-8 text-xs"
                >
                  {loadingHealth
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <ActivitySquare className="h-3.5 w-3.5" />}
                  {loadingHealth ? 'Scoring…' : 'Health Score'}
                  <span className="text-muted-foreground">5cr</span>
                </Button>
                <Button
                  size="sm"
                  onClick={handleAdvisory}
                  disabled={isAnyLoading || !prompt.trim()}
                  className="gap-1.5 h-8 text-xs"
                >
                  {loadingAdvisory
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <Lightbulb className="h-3.5 w-3.5" />}
                  {loadingAdvisory ? 'Reviewing…' : 'Advisory'}
                  <span className="opacity-70">5cr</span>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
