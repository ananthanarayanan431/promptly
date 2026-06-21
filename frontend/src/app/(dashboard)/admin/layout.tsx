'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { User } from '@/types/api';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  const { data: user, isLoading, isError } = useQuery<User>({
    queryKey: ['user', 'me'],
    queryFn: async () => {
      const res = await api.get<{ data: User }>('/api/v1/users/me');
      return res.data.data;
    },
    staleTime: 1000 * 60 * 5,
  });

  useEffect(() => {
    if (!isLoading && user !== undefined && !user.is_admin) {
      router.replace('/optimize');
    }
  }, [user, isLoading, router]);

  if (isLoading || (!user && !isError)) {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
        Loading…
      </div>
    );
  }

  if (isError || !user?.is_admin) {
    return null;
  }

  return <>{children}</>;
}
