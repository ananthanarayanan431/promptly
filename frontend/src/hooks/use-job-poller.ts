import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { JobStatusResponse } from '@/types/api';

export function useJobPoller(jobId: string | null) {
  return useQuery({
    queryKey: ['job', jobId],
    queryFn: async () => {
      const { data } = await api.get<JobStatusResponse>(`/api/v1/chat/jobs/${jobId}`);
      return data;
    },
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return 2000;
      if (data.status === 'completed' || data.status === 'failed') {
        return false;
      }
      return 2000;
    },
    enabled: !!jobId,
  });
}
