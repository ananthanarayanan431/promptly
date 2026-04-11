import { HealthScoreResponse } from '@/types/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ActivitySquare, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';

export function ScoreDisplay({ score }: { score: HealthScoreResponse }) {
  const getScoreColor = (value: number) => {
    if (value >= 80) return 'text-green-600 dark:text-green-400';
    if (value >= 60) return 'text-amber-600 dark:text-amber-400';
    return 'text-red-600 dark:text-red-400';
  };

  const getScoreIcon = (value: number) => {
    if (value >= 80) return <CheckCircle2 className={`h-5 w-5 ${getScoreColor(value)}`} />;
    if (value >= 60) return <AlertTriangle className={`h-5 w-5 ${getScoreColor(value)}`} />;
    return <XCircle className={`h-5 w-5 ${getScoreColor(value)}`} />;
  };

  const dimensions = Object.entries(score.scores).map(([key, value]) => ({
    name: key.charAt(0).toUpperCase() + key.slice(1).replace('_', ' '),
    value,
  }));

  return (
    <div className="space-y-6">
      <Card className="w-full border-primary/20 bg-primary/5">
        <CardHeader className="pb-4">
          <CardTitle className="text-xl flex items-center gap-2">
            <ActivitySquare className="h-6 w-6 text-primary" />
            Overall Health Score
          </CardTitle>
          <CardDescription>
            An aggregate score assessing the quality and effectiveness of your prompt.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <span className={`text-6xl font-black ${getScoreColor(score.overall)}`}>
              {score.overall}
            </span>
            <span className="text-2xl text-muted-foreground">/ 100</span>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
        {dimensions.map((dim) => (
          <Card key={dim.name}>
            <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm font-medium text-muted-foreground">{dim.name}</CardTitle>
              {getScoreIcon(dim.value)}
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{dim.value} <span className="text-sm text-muted-foreground font-normal">/ 100</span></div>
              <div className="mt-4 w-full bg-secondary h-2 rounded-full overflow-hidden">
                <div
                  className={`h-full ${
                    dim.value >= 80 ? 'bg-green-500' : dim.value >= 60 ? 'bg-amber-500' : 'bg-red-500'
                  }`}
                  style={{ width: `${Math.min(100, Math.max(0, dim.value))}%` }}
                />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
