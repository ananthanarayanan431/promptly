import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { Wand2, History, ActivitySquare } from 'lucide-react';
import Link from 'next/link';

export default function DashboardHome() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Welcome to Promptly</h1>
        <p className="text-muted-foreground mt-2">
          Your AI prompt optimization and analysis platform.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Optimize</CardTitle>
            <Wand2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">New Prompt</div>
            <p className="text-xs text-muted-foreground mt-1">
              Submit a prompt to the multi-model council for optimization.
            </p>
            <Link href="/optimize" className={buttonVariants({ className: 'mt-4 w-full' })}>Start Optimizing</Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">History</CardTitle>
            <History className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">Versions</div>
            <p className="text-xs text-muted-foreground mt-1">
              View your version history and track improvements.
            </p>
            <Link href="/versions" className={buttonVariants({ variant: 'outline', className: 'mt-4 w-full' })}>View History</Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Analyze</CardTitle>
            <ActivitySquare className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">Analytics</div>
            <p className="text-xs text-muted-foreground mt-1">
              Check health scores and get advisory feedback on prompts.
            </p>
            <Link href="/analyze" className={buttonVariants({ variant: 'outline', className: 'mt-4 w-full' })}>Analyze Prompts</Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
