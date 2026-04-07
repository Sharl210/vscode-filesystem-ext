import type { WorkspaceItemDto } from '../types/api';

export interface WorkspaceInput {
  name: string;
  uri: string;
  source: 'local' | 'workspace' | 'remote';
}

export interface WorkspaceRegistry {
  sync(workspaces: WorkspaceInput[]): WorkspaceItemDto[];
  list(): WorkspaceItemDto[];
  getById(id: string): WorkspaceItemDto | undefined;
}

export function createWorkspaceRegistry(): WorkspaceRegistry {
  let nextId = 1;
  const idByUri = new Map<string, string>();
  let items: WorkspaceItemDto[] = [];

  return {
    sync(workspaces) {
      items = workspaces.map((workspace) => {
        const currentId = idByUri.get(workspace.uri) ?? `ws_${nextId++}`;

        idByUri.set(workspace.uri, currentId);

        return {
          id: currentId,
          name: workspace.name,
          uri: workspace.uri,
          source: workspace.source
        };
      });

      return items;
    },
    list() {
      return [...items];
    },
    getById(id) {
      return items.find((item) => item.id === id);
    }
  };
}
