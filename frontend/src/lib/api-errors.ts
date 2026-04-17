/**
 * FastAPI returns `detail` as either a string or a list of validation errors
 * `{ type, loc, msg, input, ctx }[]`. Normalize to a single user-visible string.
 */
export function formatApiErrorDetail(detail: unknown, fallback = 'Something went wrong.'): string {
  if (detail == null || detail === '') return fallback;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    const parts = detail.map((item) => {
      if (item && typeof item === 'object' && 'msg' in item) {
        return String((item as { msg: unknown }).msg);
      }
      return typeof item === 'string' ? item : JSON.stringify(item);
    });
    return parts.filter(Boolean).join(' ') || fallback;
  }
  if (typeof detail === 'object' && detail !== null && 'msg' in detail) {
    return String((detail as { msg: unknown }).msg);
  }
  try {
    return JSON.stringify(detail);
  } catch {
    return fallback;
  }
}
