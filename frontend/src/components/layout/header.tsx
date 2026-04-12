'use client';

import { useAuthStore } from '@/stores/auth-store';
import { Badge } from '@/components/ui/badge';
import { Coins, User as UserIcon } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { User } from '@/types/api';
import { useEffect } from 'react';

export function Header() {
  const { user, setUser } = useAuthStore();

  const { data: fetchedUser } = useQuery({
    queryKey: ['user', 'me'],
    queryFn: async () => {
      const res = await api.get<{ data: User }>('/api/v1/users/me');
      return res.data.data;
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  useEffect(() => {
    if (fetchedUser) {
      setUser(fetchedUser);
    }
  }, [fetchedUser, setUser]);

  const displayUser = fetchedUser || user;

  return (
    <header className="flex h-14 items-center justify-between border-b bg-card px-6">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold tracking-tight">Dashboard</h2>
      </div>
      <div className="flex items-center gap-4">
        {displayUser && (
          <>
            <div className="flex items-center gap-2">
              <Badge variant={displayUser.credits < 20 ? 'destructive' : 'secondary'} className="px-3 py-1 text-sm font-medium">
                <Coins className="mr-1.5 h-4 w-4" />
                {displayUser.credits} Credits
              </Badge>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground border-l pl-4">
              <UserIcon className="h-4 w-4" />
              <span>{displayUser.email}</span>
            </div>
          </>
        )}
      </div>
    </header>
  );
}
