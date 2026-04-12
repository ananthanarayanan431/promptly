'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { HealthScoreResponse, AdvisoryResponse } from '@/types/api';
import { ScoreDisplay } from '@/components/analyze/score-display';
import { AdvisoryDisplay } from '@/components/analyze/advisory-display';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
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

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Prompt Analyzer</h1>
        <p className="text-muted-foreground mt-1">
          Score and review any prompt — no council run required. Each analysis costs 5 credits.
        </p>
      </div>

      {/* Input card */}
      <Card className="shadow-sm">
        <CardContent className="p-0">
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Paste the prompt you want to analyze…"
            className="min-h-[200px] resize-y text-sm leading-relaxed rounded-b-none border-0 border-b focus-visible:ring-0 shadow-none rounded-t-xl"
            maxLength={MAX_CHARS}
          />
          <div className="flex items-center justify-between px-4 py-3 bg-muted/30 rounded-b-xl">
            <span className={cn(
              'text-xs tabular-nums font-mono',
              charCount > MAX_CHARS * 0.9 ? 'text-destructive font-semibold' : 'text-muted-foreground'
            )}>
              {charCount.toLocaleString()} / {MAX_CHARS.toLocaleString()} chars
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleHealthScore}
                disabled={isAnyLoading || !prompt.trim()}
                className="gap-2 h-8"
              >
                {loadingHealth
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <ActivitySquare className="h-3.5 w-3.5" />}
                <span>{loadingHealth ? 'Scoring…' : 'Health Score'}</span>
                <span className="text-muted-foreground text-xs">5cr</span>
              </Button>
              <Button
                size="sm"
                onClick={handleAdvisory}
                disabled={isAnyLoading || !prompt.trim()}
                className="gap-2 h-8"
              >
                {loadingAdvisory
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <Lightbulb className="h-3.5 w-3.5" />}
                <span>{loadingAdvisory ? 'Reviewing…' : 'Advisory'}</span>
                <span className="opacity-70 text-xs">5cr</span>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      {healthScore && <ScoreDisplay score={healthScore} />}
      {advisory && <AdvisoryDisplay advisory={advisory} />}
    </div>
  );
}
