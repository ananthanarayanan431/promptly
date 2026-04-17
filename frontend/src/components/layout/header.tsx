'use client';

import { useAuthStore } from '@/stores/auth-store';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { User } from '@/types/api';
import { useEffect } from 'react';

export function Header() {
  const { setUser } = useAuthStore();

  const { data: fetchedUser } = useQuery({
    queryKey: ['user', 'me'],
    queryFn: async () => {
      const res = await api.get<{ data: User }>('/api/v1/users/me');
      return res.data.data;
    },
    staleTime: 1000 * 60 * 5,
  });

  useEffect(() => {
    if (fetchedUser) setUser(fetchedUser);
  }, [fetchedUser, setUser]);

  return (
    <header className="flex h-14 items-center border-b bg-card px-6">
      <h2 className="text-lg font-semibold tracking-tight">Prompt Studio</h2>
    </header>
  );
}
