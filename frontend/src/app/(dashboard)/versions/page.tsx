'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PromptFamily } from '@/types/api';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { buttonVariants } from '@/components/ui/button';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';

export default function VersionsPage() {
  const { data: families, isLoading, error } = useQuery({
    queryKey: ['prompt-families'],
    queryFn: async () => {
      const res = await api.get<{ data: { families: PromptFamily[] } }>('/api/v1/prompts/versions');
      return res.data.data.families;
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Prompt Versions</h1>
        <p className="text-muted-foreground mt-2">
          Track the history and evolution of your named prompts.
        </p>
      </div>

      <div className="rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Family Name</TableHead>
              <TableHead>Total Versions</TableHead>
              <TableHead>Latest Update</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center">
                  <div className="flex flex-col space-y-3">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-full" />
                  </div>
                </TableCell>
              </TableRow>
            )}
            {!isLoading && (!families || families.length === 0) && (
              <TableRow>
                <TableCell colSpan={4} className="h-32 text-center text-muted-foreground">
                  No prompt versions found. Start by saving a prompt during optimization.
                </TableCell>
              </TableRow>
            )}
            {families?.map((family) => {
              const latestVersion = family.versions[family.versions.length - 1];
              return (
                <TableRow key={family.prompt_id}>
                  <TableCell className="font-medium">{family.name}</TableCell>
                  <TableCell>{family.versions.length} versions</TableCell>
                  <TableCell>
                    {latestVersion?.created_at ? formatDistanceToNow(new Date(latestVersion.created_at), { addSuffix: true }) : 'Unknown'}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link href={`/versions/${family.prompt_id}`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                      View History
                    </Link>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
