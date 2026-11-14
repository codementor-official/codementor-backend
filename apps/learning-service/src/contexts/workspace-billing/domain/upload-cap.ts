/**
 * Every document upload is also capped by the platform (`DOCUMENT_MAX_UPLOAD_MB`), whatever the
 * plan grants. Buyers must see the size they can actually upload, so learner-facing billing
 * responses show `min(plan, platform)`. Admin views keep the stored plan value.
 */
export function capUploadBytes<T>(value: T, cap: number): T {
  if (Array.isArray(value)) value.forEach((item) => capUploadBytes(item, cap));
  else if (value && typeof value === 'object' && !(value instanceof Date)) {
    for (const [key, child] of Object.entries(value)) {
      if (key === 'maxUploadBytes' && typeof child === 'number') {
        (value as Record<string, unknown>)[key] = Math.min(child, cap);
      } else capUploadBytes(child, cap);
    }
  }
  return value;
}
