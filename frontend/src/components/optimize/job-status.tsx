import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Loader2, Users, MessageSquare, Crown } from 'lucide-react';
import { JobStatusResponse } from '@/types/api';
import { cn } from '@/lib/utils';

const ROUNDS = [
  { icon: Users, label: 'Round 1', description: 'Council optimizing independently' },
  { icon: MessageSquare, label: 'Round 2', description: 'Peer-reviewing each proposal' },
  { icon: Crown, label: 'Round 3', description: 'Chairman synthesizing best result' },
];

export function JobStatus({ status }: { status: JobStatusResponse['status'] }) {
  return (
    <Card className="w-full border-primary/20">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          {status === 'queued' ? 'Queued — waiting for a worker…' : 'Optimizing your prompt…'}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          {ROUNDS.map((round, idx) => {
            const Icon = round.icon;
            const isActive = status === 'started';
            return (
              <div key={idx} className="flex items-center gap-3 flex-1">
                <div className={cn(
                  'flex flex-col items-center gap-1.5 flex-1 p-3 rounded-lg border text-center transition-colors',
                  isActive
                    ? 'border-primary/40 bg-primary/5 text-foreground'
                    : 'border-border bg-muted/30 text-muted-foreground'
                )}>
                  <Icon className={cn('h-5 w-5', isActive ? 'text-primary' : 'text-muted-foreground')} />
                  <p className="text-xs font-semibold">{round.label}</p>
                  <p className="text-xs leading-tight">{round.description}</p>
                </div>
                {idx < ROUNDS.length - 1 && (
                  <div className="h-px w-4 shrink-0 bg-border" />
                )}
              </div>
            );
          })}
        </div>

        <div className="space-y-2 pt-1">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-[85%]" />
          <Skeleton className="h-3 w-[70%]" />
          <Skeleton className="h-10 w-full mt-3" />
        </div>

        <p className="text-xs text-muted-foreground text-center">
          This usually takes 20–40 seconds. Stay on this page or check back using your job ID.
        </p>
      </CardContent>
    </Card>
  );
}
