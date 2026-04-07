interface RootLike {
  id: string;
  source: 'local' | 'workspace' | 'remote';
}

export function pickInitialRootId(items: RootLike[]): string {
  return (
    items.find((item) => item.source === 'workspace')?.id ??
    items.find((item) => item.source === 'local')?.id ??
    items.find((item) => item.source === 'remote')?.id ??
    ''
  );
}
