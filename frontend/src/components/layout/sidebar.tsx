'use client';

import {
  LayoutDashboard,
  History,
  ActivitySquare,
  LogOut,
  Wand2,
  Lightbulb,
  MessageSquare,
  SquarePen,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/stores/auth-store';
import { clearToken } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import { ThemeToggle } from '@/components/landing/theme-toggle';
import { api } from '@/lib/api';
import type { SessionsGrouped, SessionSummary } from '@/types/api';

const navigation = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Optimize Prompt', href: '/optimize', icon: Wand2 },
  { name: 'Versions', href: '/versions', icon: History },
  { name: 'Analyze', href: '/analyze', icon: ActivitySquare },
];

function SessionItem({ session, isActive }: { session: SessionSummary; isActive: boolean }) {
  return (
    <Link
      href={`/optimize?session=${session.id}`}
      className={cn(
        'flex items-center gap-2 px-3 py-1.5 rounded-md text-xs transition-colors truncate',
        isActive
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      )}
      title={session.title ?? undefined}
    >
      <MessageSquare className="h-3 w-3 shrink-0" />
      <span className="truncate">{session.title || 'Untitled'}</span>
    </Link>
  );
}

function SessionGroup({
  label,
  sessions,
  currentId,
}: {
  label: string;
  sessions: SessionSummary[];
  currentId: string | null;
}) {
  if (sessions.length === 0) return null;
  return (
    <div className="mb-2">
      <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
        {label}
      </p>
      {sessions.map((s) => (
        <SessionItem key={s.id} session={s} isActive={s.id === currentId} />
      ))}
    </div>
  );
}

function SessionHistory() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentSessionId = searchParams.get('session');

  // Show "Untitled" placeholder when user is on /optimize with no saved session yet
  const isNewChat = pathname === '/optimize' && !currentSessionId;

  const { data: grouped } = useQuery<SessionsGrouped>({
    queryKey: ['sessions'],
    queryFn: async () => {
      const res = await api.get<{ data: SessionsGrouped }>('/api/v1/chat/sessions');
      return res.data.data;
    },
    staleTime: 30_000,
  });

  const hasHistory =
    grouped &&
    (grouped.today.length > 0 ||
      grouped.last_7_days.length > 0 ||
      grouped.last_30_days.length > 0 ||
      grouped.older.length > 0);

  if (!hasHistory && !isNewChat) return null;

  return (
    <div className="flex-1 overflow-y-auto min-h-0">
      {/* Section header with New Chat button */}
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
          Chats
        </span>
        <Link
          href="/optimize"
          title="New chat"
          className="h-5 w-5 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
        >
          <SquarePen className="h-3.5 w-3.5" />
        </Link>
      </div>

      <div className="px-2 pb-2">
        {/* Untitled placeholder — visible before first submit */}
        {isNewChat && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-md text-xs bg-primary/10 text-primary">
            <MessageSquare className="h-3 w-3 shrink-0" />
            <span className="truncate italic">New chat</span>
          </div>
        )}

        {hasHistory && (
          <>
            <SessionGroup label="Today" sessions={grouped!.today} currentId={currentSessionId} />
            <SessionGroup label="Last 7 days" sessions={grouped!.last_7_days} currentId={currentSessionId} />
            <SessionGroup label="Last 30 days" sessions={grouped!.last_30_days} currentId={currentSessionId} />
            <SessionGroup label="Older" sessions={grouped!.older} currentId={currentSessionId} />
          </>
        )}
      </div>
    </div>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const logout = useAuthStore((state) => state.logout);

  const handleLogout = async () => {
    logout();
    await clearToken();
    router.push('/login');
    router.refresh();
  };

  return (
    <div className="flex h-screen w-64 flex-col border-r bg-card text-card-foreground overflow-hidden">
      {/* Logo */}
      <div className="flex h-14 items-center border-b px-4 shrink-0">
        <Link href="/" className="flex items-center gap-2 font-bold text-lg text-primary">
          <Lightbulb className="h-6 w-6" />
          <span>Promptly</span>
        </Link>
      </div>

      {/* Nav links */}
      <nav className="shrink-0 space-y-1 px-4 pt-4 pb-2">
        {navigation.map((item) => {
          const isActive =
            pathname === item.href ||
            (item.href !== '/dashboard' && pathname.startsWith(item.href));
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.name}
            </Link>
          );
        })}
      </nav>

      {/* Divider */}
      <div className="mx-4 border-t" />

      {/* Session history — scrollable middle section */}
      <Suspense fallback={<div className="flex-1" />}>
        <SessionHistory />
      </Suspense>

      {/* Footer */}
      <div className="shrink-0 border-t p-4 space-y-2">
        <div className="flex items-center justify-between px-1 mb-1">
          <span className="text-xs text-muted-foreground">Theme</span>
          <ThemeToggle />
        </div>
        <Button
          variant="ghost"
          className="w-full justify-start text-muted-foreground hover:text-foreground"
          onClick={handleLogout}
        >
          <LogOut className="mr-2 h-4 w-4" />
          Logout
        </Button>
      </div>
    </div>
  );
}
