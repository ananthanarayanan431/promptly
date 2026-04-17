'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/lib/api';
import { PromptFamily, PromptVersion } from '@/types/api';
import { Skeleton } from '@/components/ui/skeleton';
import { buttonVariants } from '@/components/ui/button';
import { formatDistanceToNow } from 'date-fns';
import { Copy, CheckCheck, ArrowLeft, Wand2, GitBranch } from 'lucide-react';
import { toast } from 'sonner';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function VersionHistoryPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const { data: family, isLoading } = useQuery({
    queryKey: ['prompt-family', params.id],
    queryFn: async () => {
      const res = await api.get<{ data: PromptFamily }>(`/api/v1/prompts/versions/${params.id}`);
      return res.data.data;
    },
  });

  const [selectedVersion, setSelectedVersion] = useState<PromptVersion | null>(null);
  const [copied, setCopied] = useState(false);

  const sortedVersions = family ? [...family.versions].sort((a, b) => b.version - a.version) : [];
  const activeVersion = selectedVersion ?? sortedVersions[0] ?? null;

  const handleCopy = async () => {
    if (!activeVersion) return;
    try {
      await navigator.clipboard.writeText(activeVersion.content);
      setCopied(true);
      toast.success('Copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy');
    }
  };

  const handleOptimize = () => {
    if (!activeVersion) return;
    sessionStorage.setItem('prefill_prompt', activeVersion.content);
    sessionStorage.setItem('prefill_prompt_id', params.id);
    if (family?.name) sessionStorage.setItem('prefill_name', family.name);
    router.push('/optimize');
  };

  if (isLoading) {
    return (
      <div className="flex h-full flex-col gap-4 p-6">
        <Skeleton className="h-8 w-48" />
        <div className="flex flex-1 gap-0 rounded-xl border border-border overflow-hidden">
          <div className="w-64 shrink-0 border-r p-3 space-y-1.5">
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
          </div>
          <div className="flex-1 p-6">
            <Skeleton className="h-full w-full rounded-lg" />
          </div>
        </div>
      </div>
    );
  }

  if (!family) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Prompt family not found.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="shrink-0 flex items-center gap-3 px-6 py-4 border-b border-border/60">
        <Link href="/versions" className={buttonVariants({ variant: 'ghost', size: 'icon' })}>
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex items-center gap-2 min-w-0">
          <GitBranch className="h-4 w-4 text-primary shrink-0" />
          <h1 className="text-lg font-semibold tracking-tight truncate">{family.name}</h1>
          <span className="shrink-0 text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
            {family.versions.length} version{family.versions.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* Split panel */}
      <div className="flex flex-1 min-h-0">
        {/* Left: version list */}
        <div className="w-56 shrink-0 border-r border-border/60 overflow-y-auto bg-background/50">
          <div className="p-2 space-y-0.5">
            {sortedVersions.map((v) => {
              const isActive = activeVersion?.version === v.version;
              return (
                <button
                  key={v.version}
                  type="button"
                  onClick={() => setSelectedVersion(v)}
                  className={`w-full text-left rounded-lg px-3 py-3 transition-colors group ${
                    isActive
                      ? 'bg-primary/10 border border-primary/25'
                      : 'hover:bg-accent/60 border border-transparent'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-sm font-semibold ${isActive ? 'text-primary' : 'text-foreground'}`}>
                      v{v.version}
                    </span>
                    {v.version === sortedVersions[0]?.version && (
                      <span className="text-[10px] font-medium text-primary bg-primary/10 px-1.5 py-0.5 rounded-full leading-none">
                        latest
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-none">
                    {formatDistanceToNow(new Date(v.created_at), { addSuffix: true })}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right: content panel */}
        {activeVersion ? (
          <div className="flex flex-1 flex-col min-w-0">
            {/* Panel header */}
            <div className="shrink-0 flex items-center justify-between px-6 py-3 border-b border-border/60 bg-card">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-foreground">Version {activeVersion.version}</span>
                <span className="text-xs text-muted-foreground">
                  · {formatDistanceToNow(new Date(activeVersion.created_at), { addSuffix: true })}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopy}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors border border-border/60"
                >
                  {copied ? (
                    <><CheckCheck className="h-3.5 w-3.5 text-green-500" /> Copied</>
                  ) : (
                    <><Copy className="h-3.5 w-3.5" /> Copy</>
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleOptimize}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  <Wand2 className="h-3.5 w-3.5" />
                  Optimize
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-6 py-5">
              <p className="text-sm leading-7 whitespace-pre-wrap text-foreground font-mono">
                {activeVersion.content}
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center text-muted-foreground text-sm">
            Select a version to view its content.
          </div>
        )}
      </div>
    </div>
  );
}
