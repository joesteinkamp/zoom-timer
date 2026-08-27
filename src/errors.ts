/** Zoom SDK rejections are plain objects; the field names vary by version. */
export interface ZoomFailure {
  code: number | null;
  message: string;
}

export function toZoomFailure(error: unknown): ZoomFailure {
  if (typeof error === 'object' && error !== null) {
    const record = error as Record<string, unknown>;
    const rawCode = record.code ?? record.errorCode;
    const rawMessage = record.message ?? record.errorMessage;
    return {
      code: typeof rawCode === 'number' ? rawCode : null,
      message: typeof rawMessage === 'string' ? rawMessage : 'Unknown Zoom error',
    };
  }
  return { code: null, message: String(error) };
}
