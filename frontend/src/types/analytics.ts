export interface AnalyticsPoint {
  date: string;   // "YYYY-MM-DD", "YYYY-MM", or a label (model names for bar charts)
  value: number;
}

export interface AnalyticsSeries {
  key: string;
  label: string;
  total: number;
  time_range: string;
  data: AnalyticsPoint[];
  chart_type: 'line' | 'bar';
  color?: string;
}

export interface EndpointLatency {
  path: string;
  count: number;
  p50_ms: number;
  p95_ms: number;
}

export interface SentryIssue {
  id: string;
  short_id: string;
  title: string;
  level: 'error' | 'warning' | 'info' | 'debug';
  count: number;
  user_count: number;
  first_seen: string;
  last_seen: string;
  permalink: string;
  culprit: string;
  is_unhandled: boolean;
  priority: number | null;
  filename: string;
}

export interface SentryRelease {
  version: string;
  date_created: string;
  new_groups: number;
  commit_count: number;
}

export interface AnalyticsResponse {
  view: string;
  generated_at: string;
  statics: Record<string, number | string>;
  series: AnalyticsSeries[];
  raw?: {
    sentry_issues?: SentryIssue[];
    sentry_releases?: SentryRelease[];
    endpoint_latency?: EndpointLatency[];
    [key: string]: unknown;
  };
}

// Helper: find a single series by key
export function getSeries(res: AnalyticsResponse, key: string): AnalyticsSeries | undefined {
  return res.series.find(s => s.key === key);
}

// Helper: find all series whose keys start with prefix (e.g. "so_tier_")
export function getSeriesGroup(res: AnalyticsResponse, prefix: string): AnalyticsSeries[] {
  return res.series.filter(s => s.key.startsWith(prefix));
}
