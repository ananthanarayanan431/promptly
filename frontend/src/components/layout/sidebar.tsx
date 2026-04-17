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
  Coins,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import { clearToken } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import type { SessionsGrouped, SessionSummary, User } from '@/types/api';

const navigation = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Optimize Prompt', href: '/optimize', icon: Wand2 },
  { name: 'Versions', href: '/versions', icon: History },
  { name: 'Analyze', href: '/analyze', icon: ActivitySquare },
];

function deriveDisplayName(email: string): string {
  const prefix = email.split('@')[0];
  // Turn dots/underscores/hyphens into spaces, capitalize each word
  return prefix
    .replace(/[._-]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function UserInitials({ name }: { name: string }) {
  const initials = name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
  return (
    <div className="h-8 w-8 rounded-full bg-primary/15 border border-primary/25 flex items-center justify-center shrink-0">
      <span className="text-xs font-semibold text-primary">{initials}</span>
    </div>
  );
}

function SessionItem({ session, isActive }: { session: SessionSummary; isActive: boolean }) {
  return (
    <Link
      href={`/optimize?session=${session.id}`}
      className={cn(
        'flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-colors truncate',
        isActive
          ? 'bg-foreground text-background font-medium'
          : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
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
      <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
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
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
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
        {isNewChat && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-md text-xs bg-primary/10 text-primary">
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
  const { logout, user } = useAuthStore();

  const { data: fetchedUser } = useQuery<User>({
    queryKey: ['user', 'me'],
    queryFn: async () => {
      const res = await api.get<{ data: User }>('/api/v1/users/me');
      return res.data.data;
    },
    staleTime: 1000 * 60 * 5,
  });

  const displayUser = fetchedUser ?? user;
  const displayName = displayUser ? deriveDisplayName(displayUser.email) : '';

  const handleLogout = async () => {
    logout();
    await clearToken();
    router.push('/login');
    router.refresh();
  };

  return (
    <div className="flex h-screen w-64 flex-col border-r bg-card text-card-foreground overflow-hidden">
      {/* Logo */}
      <div className="flex h-14 items-center px-4 shrink-0 relative">
        <Link href="/" className="flex items-center gap-2 font-bold text-lg text-primary">
          <Lightbulb className="h-6 w-6" />
          <span>Promptly</span>
        </Link>
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-border/60 via-border/30 to-transparent" />
      </div>

      {/* New chat button */}
      <div className="shrink-0 px-4 pt-4 pb-2">
        <Link
          href="/optimize"
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-foreground text-background text-sm font-semibold h-9 hover:bg-foreground/90 transition-colors"
        >
          <span className="text-base leading-none">+</span> New chat
        </Link>
      </div>

      {/* Nav links */}
      <nav className="shrink-0 space-y-1 px-4 pb-2">
        {navigation.map((item) => {
          const isActive =
            pathname === item.href ||
            (item.href !== '/dashboard' && pathname.startsWith(item.href));
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
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

      {/* User profile footer */}
      {displayUser && (
        <div className="shrink-0 border-t p-3 space-y-2">
          {/* Credits row */}
          <div className="flex items-center gap-1.5 px-1">
            <Coins className="h-3.5 w-3.5 text-muted-foreground" />
            <span className={cn(
              'text-xs font-medium',
              displayUser.credits < 20 ? 'text-destructive' : 'text-muted-foreground'
            )}>
              {displayUser.credits} credits remaining
            </span>
          </div>

          {/* Avatar + name/email + logout */}
          <div className="flex items-center gap-2.5 rounded-xl px-2 py-2 bg-muted/40">
            <UserInitials name={displayName} />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-foreground truncate">{displayName}</p>
              <p className="text-[10px] text-muted-foreground truncate">{displayUser.email}</p>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              title="Log out"
              className="shrink-0 h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
