/**
 * The model narrates in markdown (bold headers, etc). Nothing that renders
 * this text — the activity timeline, the live trigger toast, the WhatsApp
 * body — parses markdown, so left alone it shows literal `**`. Strip it once
 * at the source rather than patching every render site separately.
 */
export function stripMarkdownEmphasis(value: string): string;
export function stripMarkdownEmphasis(
  value: string | null | undefined,
): string | null;
export function stripMarkdownEmphasis(
  value: string | null | undefined,
): string | null {
  if (!value) return value ?? null;
  return value.replaceAll(/\*\*(.+?)\*\*/g, "$1");
}
