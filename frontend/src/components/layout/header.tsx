'use client';

import { useAuthStore } from '@/stores/auth-store';
import { Badge } from '@/components/ui/badge';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Coins, User as UserIcon, Mail, CreditCard, CalendarDays } from 'lucide-react';
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
    staleTime: 1000 * 60 * 5,
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
        <h2 className="text-lg font-semibold tracking-tight">Prompt Studio</h2>
      </div>
      <div className="flex items-center gap-4">
        {displayUser && (
          <>
            <Badge
              variant={displayUser.credits < 20 ? 'destructive' : 'secondary'}
              className="px-3 py-1 text-sm font-medium"
            >
              <Coins className="mr-1.5 h-4 w-4" />
              {displayUser.credits} Credits
            </Badge>

            <Popover>
              <PopoverTrigger className="flex items-center gap-2 text-sm text-muted-foreground border-l pl-4 hover:text-foreground transition-colors cursor-pointer">
                <UserIcon className="h-4 w-4" />
                <span>{displayUser.email}</span>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-72 p-0">
                <div className="px-4 py-3 border-b">
                  <p className="text-sm font-semibold">Account Info</p>
                </div>
                <div className="px-4 py-3 space-y-3">
                  <div className="flex items-start gap-3">
                    <Mail className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                    <div>
                      <p className="text-xs text-muted-foreground">Email</p>
                      <p className="text-sm font-medium break-all">{displayUser.email}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <CreditCard className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                    <div>
                      <p className="text-xs text-muted-foreground">Credits remaining</p>
                      <p className={`text-sm font-medium ${displayUser.credits < 20 ? 'text-destructive' : ''}`}>
                        {displayUser.credits}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <CalendarDays className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                    <div>
                      <p className="text-xs text-muted-foreground">Member since</p>
                      <p className="text-sm font-medium">
                        {new Date(displayUser.created_at).toLocaleDateString(undefined, {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric',
                        })}
                      </p>
                    </div>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </>
        )}
      </div>
    </header>
  );
}
