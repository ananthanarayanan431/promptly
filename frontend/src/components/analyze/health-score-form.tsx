'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { healthScoreSchema, HealthScoreFormData } from '@/lib/schemas';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardFooter } from '@/components/ui/card';

interface HealthScoreFormProps {
  onSubmit: (prompt: string) => void;
  isLoading: boolean;
  buttonText: string;
}

export function HealthScoreForm({ onSubmit, isLoading, buttonText }: HealthScoreFormProps) {
  const { register, handleSubmit, formState: { errors } } = useForm<HealthScoreFormData>({
    resolver: zodResolver(healthScoreSchema),
  });

  const submitWrapper = (data: HealthScoreFormData) => {
    onSubmit(data.prompt);
  };

  return (
    <Card className="w-full">
      <CardContent className="pt-6">
        <form id="analyze-form" onSubmit={handleSubmit(submitWrapper)} className="space-y-4">
          <div className="space-y-2">
            <Textarea
              placeholder="Paste the prompt you want to analyze..."
              className="min-h-[150px] resize-y"
              {...register('prompt')}
            />
            {errors.prompt && <p className="text-sm text-red-500">{errors.prompt.message}</p>}
          </div>
        </form>
      </CardContent>
      <CardFooter className="flex justify-end border-t p-4">
        <Button form="analyze-form" type="submit" disabled={isLoading} className="w-full md:w-auto">
          {isLoading ? 'Analyzing...' : buttonText}
        </Button>
      </CardFooter>
    </Card>
  );
}
