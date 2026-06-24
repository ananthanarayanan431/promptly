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

export interface AnalyticsResponse {
  view: string;
  generated_at: string;
  statics: Record<string, number | string>;
  series: AnalyticsSeries[];
}

// Helper: find a single series by key
export function getSeries(res: AnalyticsResponse, key: string): AnalyticsSeries | undefined {
  return res.series.find(s => s.key === key);
}

// Helper: find all series whose keys start with prefix (e.g. "so_tier_")
export function getSeriesGroup(res: AnalyticsResponse, prefix: string): AnalyticsSeries[] {
  return res.series.filter(s => s.key.startsWith(prefix));
}
