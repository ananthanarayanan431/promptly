'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PromptFamily } from '@/types/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDistanceToNow } from 'date-fns';
import { Copy, CheckCheck, ArrowLeft, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PageContainer } from '@/components/layout/page-container';

export default function VersionHistoryPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const { data: family, isLoading } = useQuery({
    queryKey: ['prompt-family', params.id],
    queryFn: async () => {
      const res = await api.get<{ data: PromptFamily }>(`/api/v1/prompts/versions/${params.id}`);
      return res.data.data;
    },
  });

  const [copiedId, setCopiedId] = useState<number | null>(null);

  const handleCopy = async (content: string, version: number) => {
    await navigator.clipboard.writeText(content);
    setCopiedId(version);
    toast.success('Copied to clipboard');
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleOptimizeVersion = (content: string) => {
    // Navigate to optimize page but first we need a way to pre-fill it.
    // Easiest is to save it in sessionStorage, or passing via URL params if short.
    // For now we will use sessionStorage
    sessionStorage.setItem('prefill_prompt', content);
    sessionStorage.setItem('prefill_prompt_id', params.id);
    if (family?.name) {
      sessionStorage.setItem('prefill_name', family.name);
    }
    router.push('/optimize');
  };

  if (isLoading) {
    return (
      <PageContainer>
        <div className="space-y-6">
          <Skeleton className="h-10 w-[200px]" />
          <Skeleton className="h-[200px] w-full" />
          <Skeleton className="h-[200px] w-full" />
        </div>
      </PageContainer>
    );
  }

  if (!family) {
    return <PageContainer><div>Prompt family not found.</div></PageContainer>;
  }

  // Sort versions descending
  const sortedVersions = [...family.versions].sort((a, b) => b.version - a.version);

  return (
    <PageContainer>
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/versions" className={buttonVariants({ variant: 'ghost', size: 'icon' })}>
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{family.name}</h1>
          <p className="text-muted-foreground mt-1">
            Tracking {family.versions.length} versions
          </p>
        </div>
      </div>

      <div className="relative border-l-2 border-muted ml-4 space-y-8 pb-4">
        {sortedVersions.map((v) => (
          <div key={v.version} className="relative pl-8">
            <div className="absolute w-4 h-4 rounded-full bg-primary -left-[9px] top-4 border-4 border-background" />
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-lg">Version {v.version}</CardTitle>
                <div className="text-sm text-muted-foreground">
                  {formatDistanceToNow(new Date(v.created_at), { addSuffix: true })}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="relative group">
                  <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button variant="secondary" size="icon" className="h-8 w-8" onClick={() => handleCopy(v.content, v.version)}>
                      {copiedId === v.version ? <CheckCheck className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  </div>
                  <div className="bg-muted p-4 rounded-md text-sm whitespace-pre-wrap font-mono">
                    {v.content}
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button variant="outline" size="sm" onClick={() => handleOptimizeVersion(v.content)}>
                    <Wand2 className="mr-2 h-4 w-4" />
                    Optimize This Version
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        ))}
      </div>
    </div>
    </PageContainer>
  );
}
