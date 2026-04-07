export function normalizeEntryName(value: string): string {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new Error('名称不能为空');
  }

  if (trimmed === '.' || trimmed === '..' || trimmed.includes('/') || trimmed.includes('\\')) {
    throw new Error('名称不能包含路径');
  }

  return trimmed;
}
