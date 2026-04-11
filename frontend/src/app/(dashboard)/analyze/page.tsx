'use client';

import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { HealthScoreForm } from '@/components/analyze/health-score-form';
import { ScoreDisplay } from '@/components/analyze/score-display';
import { AdvisoryDisplay } from '@/components/analyze/advisory-display';
import { HealthScoreResponse, AdvisoryResponse } from '@/types/api';
import { api } from '@/lib/api';
import { toast } from 'sonner';

export default function AnalyzePage() {
  const [healthScore, setHealthScore] = useState<HealthScoreResponse | null>(null);
  const [advisory, setAdvisory] = useState<AdvisoryResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const handleHealthScore = async (prompt: string) => {
    setLoading(true);
    try {
      const res = await api.post<HealthScoreResponse>('/api/v1/prompts/health-score', { prompt });
      setHealthScore(res.data);
    } catch (error) {
      toast.error('Failed to analyze health score');
    } finally {
      setLoading(false);
    }
  };

  const handleAdvisory = async (prompt: string) => {
    setLoading(true);
    try {
      const res = await api.post<AdvisoryResponse>('/api/v1/prompts/advisory', { prompt });
      setAdvisory(res.data);
    } catch (error) {
      toast.error('Failed to get advisory');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Analyze Prompt</h1>
        <p className="text-muted-foreground mt-2">
          Get detailed insights and actionable feedback on your prompts without running them through the council.
        </p>
      </div>

      <Tabs defaultValue="health-score" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="health-score">Health Score</TabsTrigger>
          <TabsTrigger value="advisory">Advisory</TabsTrigger>
        </TabsList>
        <TabsContent value="health-score" className="mt-6 space-y-6">
          <HealthScoreForm onSubmit={handleHealthScore} isLoading={loading} buttonText="Get Health Score" />
          {healthScore && <ScoreDisplay score={healthScore} />}
        </TabsContent>
        <TabsContent value="advisory" className="mt-6 space-y-6">
          <HealthScoreForm onSubmit={handleAdvisory} isLoading={loading} buttonText="Get Advisory" />
          {advisory && <AdvisoryDisplay advisory={advisory} />}
        </TabsContent>
      </Tabs>
    </div>
  );
}
