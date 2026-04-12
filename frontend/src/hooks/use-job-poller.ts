import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { JobStatusResponse } from '@/types/api';

export function useJobPoller(jobId: string | null) {
  return useQuery({
    queryKey: ['job', jobId],
    queryFn: async () => {
      const { data } = await api.get<{ data: JobStatusResponse }>(`/api/v1/chat/jobs/${jobId}`);
      return data.data;
    },
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === 'completed' || status === 'failed') return false;
      return 2000;
    },
    enabled: !!jobId,
  });
}
