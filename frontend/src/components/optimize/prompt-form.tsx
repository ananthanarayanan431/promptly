'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { optimizePromptSchema, OptimizePromptFormData } from '@/lib/schemas';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Sparkles, Loader2 } from 'lucide-react';

interface PromptFormProps {
  onSubmit: (data: OptimizePromptFormData) => void;
  isLoading: boolean;
}

export function PromptForm({ onSubmit, isLoading }: PromptFormProps) {
  const [charCount, setCharCount] = useState(0);

  const { register, handleSubmit, setValue, watch, formState: { errors } } = useForm<OptimizePromptFormData>({
    resolver: zodResolver(optimizePromptSchema),
    defaultValues: { prompt: '', name: '', feedback: '' },
  });

  const promptValue = watch('prompt') ?? '';

  useEffect(() => {
    setCharCount(promptValue.length);
  }, [promptValue]);

  useEffect(() => {
    const prefillContent = sessionStorage.getItem('prefill_prompt');
    const prefillId = sessionStorage.getItem('prefill_prompt_id');
    const prefillName = sessionStorage.getItem('prefill_name');

    if (prefillContent) {
      setTimeout(() => {
        setValue('prompt', prefillContent);
        if (prefillName) setValue('name', prefillName);
        if (prefillId) setValue('prompt_id', prefillId);
      }, 0);
    }
  }, [setValue]);

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          Optimize Prompt
        </CardTitle>
        <CardDescription>
          Submit your prompt to the multi-model council for expert optimization.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form id="optimize-form" onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          {/* Prompt textarea */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="prompt">Prompt Content</Label>
              <span className="text-xs text-muted-foreground tabular-nums">
                {charCount.toLocaleString()} characters
              </span>
            </div>
            <Textarea
              id="prompt"
              placeholder="Paste the prompt you want to optimize…"
              className="min-h-[160px] resize-y font-mono text-sm"
              {...register('prompt')}
            />
            {errors.prompt && (
              <p className="text-xs text-destructive">{errors.prompt.message}</p>
            )}
          </div>

          {/* Name + Feedback side by side */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">
                Save As <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Input
                id="name"
                placeholder="e.g. Sales Email Outreach"
                {...register('name')}
              />
              <p className="text-xs text-muted-foreground">
                Track results as a named version family.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="feedback">
                Optimization Goal <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Input
                id="feedback"
                placeholder="e.g. Keep it under 50 words"
                {...register('feedback')}
              />
              <p className="text-xs text-muted-foreground">
                Guide the council on what to prioritize.
              </p>
            </div>
          </div>
        </form>
      </CardContent>

      <CardFooter className="flex items-center justify-between border-t px-6 py-4">
        <p className="text-xs text-muted-foreground">Costs 10 credits per run.</p>
        <Button form="optimize-form" type="submit" disabled={isLoading} className="gap-2">
          {isLoading ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> Submitting…</>
          ) : (
            <><Sparkles className="h-4 w-4" /> Optimize Prompt</>
          )}
        </Button>
      </CardFooter>
    </Card>
  );
}
