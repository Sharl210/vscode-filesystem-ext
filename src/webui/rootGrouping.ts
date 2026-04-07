interface RootItem {
  id: string;
  name: string;
  uri: string;
  source: 'local' | 'workspace' | 'remote';
}

interface RootGroup {
  label: '本机' | '工作区' | '远程';
  items: RootItem[];
}

const SOURCE_ORDER: Array<RootItem['source']> = ['local', 'workspace', 'remote'];

export function groupRootsBySource(items: RootItem[]): RootGroup[] {
  return SOURCE_ORDER.map((source) => ({
    label: sourceLabel(source),
    items: items.filter((item) => item.source === source)
  })).filter((group) => group.items.length > 0);
}

function sourceLabel(source: RootItem['source']): RootGroup['label'] {
  switch (source) {
    case 'local':
      return '本机';
    case 'workspace':
      return '工作区';
    case 'remote':
      return '远程';
  }
}
