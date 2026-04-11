'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { optimizePromptSchema, OptimizePromptFormData } from '@/lib/schemas';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';

interface PromptFormProps {
  onSubmit: (data: OptimizePromptFormData) => void;
  isLoading: boolean;
}

export function PromptForm({ onSubmit, isLoading }: PromptFormProps) {
  const [hasPrefillId, setHasPrefillId] = useState(false);

  const { register, handleSubmit, setValue, formState: { errors } } = useForm<OptimizePromptFormData>({
    resolver: zodResolver(optimizePromptSchema),
    defaultValues: {
      prompt: '',
      name: '',
      feedback: '',
    }
  });

  useEffect(() => {
    const prefillContent = sessionStorage.getItem('prefill_prompt');
    const prefillId = sessionStorage.getItem('prefill_prompt_id');
    const prefillName = sessionStorage.getItem('prefill_name');

    if (prefillContent) {
      setTimeout(() => {
        setValue('prompt', prefillContent);
        if (prefillName) setValue('name', prefillName);
        if (prefillId) {
          setValue('prompt_id', prefillId);
          setHasPrefillId(true);
        }
      }, 0);
    }
  }, [setValue]);

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="text-xl flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          Optimize Prompt
        </CardTitle>
        <CardDescription>
          Submit your prompt to the multi-model council for expert optimization.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form id="optimize-form" onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="prompt">Prompt Content</Label>
            <Textarea
              id="prompt"
              placeholder="Enter the prompt you want to optimize..."
              className="min-h-[150px] resize-y"
              {...register('prompt')}
            />
            {errors.prompt && <p className="text-sm text-red-500">{errors.prompt.message}</p>}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">Save As (Optional)</Label>
              <Input
                id="name"
                placeholder="e.g. Sales Email Outreach"
                {...register('name')}
              />
              <p className="text-xs text-muted-foreground">Give it a name to save as a version family.</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="feedback">Optimization Goal (Optional)</Label>
              <Input
                id="feedback"
                placeholder="e.g. Make it more professional and concise"
                {...register('feedback')}
              />
              <p className="text-xs text-muted-foreground">Guide the council on what to focus on.</p>
            </div>
          </div>
        </form>
      </CardContent>
      <CardFooter className="flex justify-end border-t p-4">
        <Button form="optimize-form" type="submit" disabled={isLoading} className="w-full md:w-auto">
          {isLoading ? 'Submitting...' : 'Optimize Prompt (10 Credits)'}
        </Button>
      </CardFooter>
    </Card>
  );
}
