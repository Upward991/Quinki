// Helper per sidecar attachments (estratto da src/main/index.ts per testabilità)

export function buildSidecarEntry(
  existing: Record<string, any[]>,
  messageId: string,
  files: any[],
  contentKey?: string
): Record<string, any[]> {
  const next = { ...existing };
  next[messageId] = files;
  if (contentKey) {
    next[`content:${contentKey}`] = files;
  }
  return next;
}
