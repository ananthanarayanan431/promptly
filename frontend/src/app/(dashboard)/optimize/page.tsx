'use client';

import { useState } from 'react';
import { PromptForm } from '@/components/optimize/prompt-form';
import { JobStatus } from '@/components/optimize/job-status';
import { ResultCard } from '@/components/optimize/result-card';
import { useJobPoller } from '@/hooks/use-job-poller';
import { OptimizePromptFormData } from '@/lib/schemas';
import { api } from '@/lib/api';
import { JobSubmitResponse } from '@/types/api';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';

export default function OptimizePage() {
  const [jobId, setJobId] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem('optimize_job_id');
    }
    return null;
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const queryClient = useQueryClient();

  const { data: jobData, error } = useJobPoller(jobId);

  const handleSubmit = async (data: OptimizePromptFormData) => {
    setIsSubmitting(true);
    setJobId(null); // Reset current job

    try {
      const res = await api.post<{ data: JobSubmitResponse }>('/api/v1/chat/', data);
      const newJobId = res.data.data.job_id;
      setJobId(newJobId);
      sessionStorage.setItem('optimize_job_id', newJobId);

      // Invalidate user cache to force credits update
      queryClient.invalidateQueries({ queryKey: ['user', 'me'] });

      toast.success('Optimization job queued!');
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Failed to submit prompt');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">AI Prompt Optimizer</h1>
        <p className="text-muted-foreground mt-2">
          Leverage a council of diverse AI models to refine and perfect your prompts automatically.
        </p>
      </div>

      <PromptForm onSubmit={handleSubmit} isLoading={isSubmitting} />

      {jobData && (jobData.status === 'queued' || jobData.status === 'started') && (
        <JobStatus status={jobData.status} />
      )}

      {jobData && jobData.status === 'completed' && jobData.result && (
        <ResultCard result={jobData.result} />
      )}

      {jobData && jobData.status === 'failed' && (
        <div className="bg-destructive/10 border border-destructive text-destructive px-4 py-3 rounded-md">
          <p className="font-semibold">Optimization Failed</p>
          <p className="text-sm mt-1">{jobData.error || 'The council encountered an error. Please try again.'}</p>
        </div>
      )}

      {error && (
        <div className="bg-destructive/10 border border-destructive text-destructive px-4 py-3 rounded-md">
          <p className="font-semibold">Network Error</p>
          <p className="text-sm mt-1">Failed to poll job status. Check your connection.</p>
        </div>
      )}
    </div>
  );
}
