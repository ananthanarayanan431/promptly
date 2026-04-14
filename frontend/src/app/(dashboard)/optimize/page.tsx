import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import { OptimizeChat } from '@/components/optimize/optimize-chat';

export default function OptimizePage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-full">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <OptimizeChat />
    </Suspense>
  );
}
