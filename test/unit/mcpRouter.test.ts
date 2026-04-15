import { describe, expect, it, vi } from 'vitest';
import { createMcpRouter } from '../../src/server/mcpRouter';

function createRouterForTest(options: { path?: string } = {}) {
  const textFiles = new Map<string, string>([
    ['a.ts', 'export const a = 1;'],
    ['src/notes.txt', 'alpha\nbeta\ngamma\ndelta\nepsilon\n'],
    ['src/app.ts', 'export function hello() {\n  return "hello";\n}\n'],
    ['src/utils.ts', 'export const utils = true;\n'],
    ['config/settings.json', '{"compilerOptions":{"strict":true},"targets":["es2022"]}\n']
  ]);
  const tabs: Array<{
    tabId: string;
    title: string;
    cwd: string;
    status: 'idle' | 'running';
    isDefault: boolean;
    lastActiveAt: string;
    recentCommands: string[];
    content: string;
    historyVersion: number;
  }> = [];
  const executions = new Map<string, {
    snapshot: {
      executionId: string;
      tabId: string;
      command: string;
      cwd: string;
      status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
      createdAt: string;
      startedAt: string | null;
      finishedAt: string | null;
      exitCode: number | null;
      timedOut: boolean;
      error: string | null;
    };
    output: {
      executionId: string;
      tabId: string;
      command: string;
      cwd: string;
      stdout: string;
      stderr: string;
      combinedOutput: string;
      exitCode: number | null;
      timedOut: boolean;
      finishedAt: string | null;
    } | null;
  }>();
  let nextTabId = 1;
  let nextExecutionId = 1;
  let defaultTabId: string | null = null;

  function syncDefaultFlags() {
    for (const tab of tabs) {
      tab.isDefault = tab.tabId === defaultTabId;
    }
  }

  function createFileEntry(relativePath: string, mimeType: string, size: number) {
    return {
      name: relativePath.split('/').at(-1) ?? relativePath,
      path: relativePath,
      type: 'file' as const,
      size,
      mtime: 1,
      mimeType,
      isText: true,
      downloadable: true
    };
  }

  const executor = {
    reads: {
      getWorkspaces: vi.fn(() => [
        {
          id: 'ws_demo',
          name: 'demo',
          uri: 'file:///workspace/demo',
          source: 'workspace' as const
        }
      ]),
      getInitialLocation: vi.fn(() => null),
      getConnectionInfo: vi.fn(() => ({
        kind: 'local' as const,
        label: '本机',
        host: 'local-host',
        remoteName: null,
        authority: null
      })),
      getActiveEditor: vi.fn(() => ({
        uri: 'file:///workspace/demo/src/app.ts',
        path: 'src/app.ts',
        languageId: 'typescript',
        version: 1,
        isDirty: false,
        lineCount: 3,
        selections: [{ start: { line: 1, character: 17 }, end: { line: 1, character: 22 } }]
      })),
      listOpenDocuments: vi.fn(() => ({
        items: [
          {
            uri: 'file:///workspace/demo/src/app.ts',
            path: 'src/app.ts',
            languageId: 'typescript',
            version: 1,
            isDirty: false,
            lineCount: 3
          },
          {
            uri: 'file:///workspace/demo/config/settings.json',
            path: 'config/settings.json',
            languageId: 'json',
            version: 1,
            isDirty: false,
            lineCount: 1
          }
        ]
      })),
      findFiles: vi.fn(async ({ includePattern }: { includePattern: string }) => {
        const allPaths = ['src/app.ts', 'src/notes.txt', 'src/utils.ts', 'config/settings.json'];
        const matcher = new RegExp(`^${includePattern
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*\*/g, '::DOUBLE_STAR::')
          .replace(/\*/g, '[^/]*')
          .replace(/\?/g, '.')
          .replace(/::DOUBLE_STAR::/g, '.*')}$`);
        return allPaths
          .filter((path) => matcher.test(path))
          .map((path) => ({ uri: `file:///workspace/demo/${path}`, path }));
      }),
      getWorkspaceById: vi.fn((id: string) => (id === 'ws_demo'
        ? {
            id: 'ws_demo',
            name: 'demo',
            uri: 'file:///workspace/demo',
            source: 'workspace' as const
          }
        : undefined)),
      resolveWorkspacePath: vi.fn((workspaceUri: string, relativePath: string) => `${workspaceUri}/${relativePath}`)
    },
    files: {
      listDirectory: vi.fn(async (_directoryUri: string, directoryPath: string) => {
        if (directoryPath === '') {
          return [
            {
              name: 'config',
              path: 'config',
              type: 'directory' as const,
              size: 0,
              mtime: 1,
              mimeType: 'inode/directory',
              isText: false,
              downloadable: true
            },
            {
              name: 'src',
              path: 'src',
              type: 'directory' as const,
              size: 0,
              mtime: 1,
              mimeType: 'inode/directory',
              isText: false,
              downloadable: true
            }
          ];
        }

        if (directoryPath === 'src') {
          return [
            createFileEntry('src/app.ts', 'text/typescript', textFiles.get('src/app.ts')?.length ?? 0),
            createFileEntry('src/notes.txt', 'text/plain', textFiles.get('src/notes.txt')?.length ?? 0),
            createFileEntry('src/utils.ts', 'text/typescript', textFiles.get('src/utils.ts')?.length ?? 0)
          ];
        }

        if (directoryPath === 'config') {
          return [
            createFileEntry('config/settings.json', 'application/json', textFiles.get('config/settings.json')?.length ?? 0)
          ];
        }

        return [];
      }),
      readTextFile: vi.fn(async (_fileUri: string, relativePath: string, options?: { offset?: number; limit?: number; withLineNumbers?: boolean }) => {
        const fileContent = textFiles.get(relativePath) ?? textFiles.get('a.ts') ?? 'export const a = 1;';
        if (relativePath === 'src/notes.txt' && options?.offset === 2 && options.limit === 2 && options.withLineNumbers === true) {
          return {
            file: {
              name: 'notes.txt',
              path: 'src/notes.txt',
              type: 'file' as const,
              size: 31,
              mtime: 1,
              mimeType: 'text/plain',
              isText: true,
              downloadable: true
            },
            content: '2: beta\n3: gamma',
            encoding: 'utf-8' as const,
            editable: true,
            slice: {
              offset: 2,
              limit: 2,
              totalLines: 5,
              returnedLineStart: 2,
              returnedLineEnd: 3,
              truncated: true,
              withLineNumbers: true,
              nextOffset: 4
            }
          };
        }

        return {
          file: createFileEntry(relativePath, relativePath.endsWith('.json') ? 'application/json' : 'text/typescript', fileContent.length),
          content: fileContent,
          encoding: 'utf-8' as const,
          editable: true
        };
      }),
      writeTextFile: vi.fn(async (fileUri: string, content: string) => {
        const targetPath = fileUri.replace('file:///workspace/demo/', '');
        const nextContent = content;
        textFiles.set(targetPath, nextContent);
      }),
      readBinaryFile: vi.fn(async () => ({
        data: Uint8Array.from([48, 49, 50, 51, 52, 53, 54, 55, 56, 57]),
        mimeType: 'application/octet-stream',
        fileName: 'logo.bin'
      })),
      exportArchive: vi.fn(),
      exportDisguisedImage: vi.fn(),
      uploadFile: vi.fn(),
      createFile: vi.fn(),
      writeFileBytes: vi.fn(),
      deleteEntry: vi.fn(),
      createDirectory: vi.fn(),
      renameEntry: vi.fn(),
      copyEntry: vi.fn(),
      moveEntry: vi.fn()
    },
    exports: {
      startJob: vi.fn(() => ({
        jobId: 'job-1',
        status: 'running',
        format: 'archive',
        progress: 10,
        stage: 'preparing',
        currentMessage: 'running',
        messages: ['running'],
        fileName: null,
        error: null
      })),
      getJob: vi.fn(() => null),
      getDownload: vi.fn(() => ({
        data: new TextEncoder().encode('archive-bytes'),
        mimeType: 'application/x-tar',
        fileName: 'archive.tar'
      })),
      consumeDownload: vi.fn(() => ({
        data: new TextEncoder().encode('archive-bytes'),
        mimeType: 'application/x-tar',
        fileName: 'archive.tar'
      })),
      cancelJob: vi.fn(() => true)
    },
    language: {
      getDiagnostics: vi.fn(async () => ({
        items: [
          {
            uri: 'file:///workspace/demo/src/app.ts',
            path: 'src/app.ts',
            severity: 'warning',
            message: 'unused symbol',
            source: 'tsserver',
            code: '6133',
            range: {
              start: { line: 2, character: 3 },
              end: { line: 2, character: 9 }
            }
          }
        ]
      })),
      getDefinition: vi.fn(async () => ({
        items: [
          {
            uri: 'file:///workspace/demo/src/app.ts',
            path: 'src/app.ts',
            range: {
              start: { line: 1, character: 1 },
              end: { line: 1, character: 8 }
            }
          }
        ]
      })),
      findReferences: vi.fn(async () => ({
        items: [
          {
            uri: 'file:///workspace/demo/src/app.ts',
            path: 'src/app.ts',
            range: {
              start: { line: 2, character: 10 },
              end: { line: 2, character: 15 }
            }
          },
          {
            uri: 'file:///workspace/demo/src/utils.ts',
            path: 'src/utils.ts',
            range: {
              start: { line: 1, character: 14 },
              end: { line: 1, character: 19 }
            }
          }
        ]
      })),
      getDocumentSymbols: vi.fn(async () => ({
        items: [
          {
            name: 'hello',
            kind: 'function',
            path: 'src/app.ts',
            range: {
              start: { line: 1, character: 1 },
              end: { line: 3, character: 1 }
            },
            selectionRange: {
              start: { line: 1, character: 17 },
              end: { line: 1, character: 22 }
            }
          }
        ]
      })),
      getWorkspaceSymbols: vi.fn(async () => ({
        items: [
          {
            name: 'hello',
            kind: 'function',
            path: 'src/app.ts',
            containerName: null,
            range: {
              start: { line: 1, character: 1 },
              end: { line: 3, character: 1 }
            }
          }
        ]
      })),
      getHover: vi.fn(async () => ({
        items: [
          {
            path: 'src/app.ts',
            range: {
              start: { line: 1, character: 17 },
              end: { line: 1, character: 22 }
            },
            contents: '```ts\nfunction hello(): string\n```'
          }
        ]
      })),
      getCodeActions: vi.fn(async () => ({
        items: [
          {
            title: 'Add explicit return type',
            kind: 'quickfix',
            disabledReason: null
          }
        ]
      })),
      prepareRename: vi.fn(async () => ({
        range: {
          start: { line: 1, character: 17 },
          end: { line: 1, character: 22 }
        },
        placeholder: 'hello'
      })),
      getRenameEdits: vi.fn(async () => ({
        changes: [
          {
            path: 'src/app.ts',
            edits: [
              {
                range: {
                  start: { line: 1, character: 17 },
                  end: { line: 1, character: 22 }
                },
                newText: 'greet'
              }
            ]
          },
          {
            path: 'src/utils.ts',
            edits: [
              {
                range: {
                  start: { line: 1, character: 14 },
                  end: { line: 1, character: 19 }
                },
                newText: 'greet'
              }
            ]
          }
        ]
      })),
      getFormatEdits: vi.fn(async () => ({
        changes: [
          {
            path: 'src/app.ts',
            edits: [
              {
                range: {
                  start: { line: 2, character: 2 },
                  end: { line: 2, character: 18 }
                },
                newText: '  return "hello";'
              }
            ]
          }
        ]
      }))
    },
    terminal: {
      listTabs: vi.fn(() => ({
        tabs: tabs.map(({ content: _content, historyVersion: _historyVersion, ...tab }) => ({ ...tab })),
        defaultTabId
      })),
      getTabContent: vi.fn((tabId: string) => {
        const tab = tabs.find((item) => item.tabId === tabId);
        if (!tab) {
          throw new Error(`Unknown terminal tab: ${tabId}`);
        }

        return {
          tabId: tab.tabId,
          title: tab.title,
          status: tab.status,
          content: tab.content,
          recentCommands: [...tab.recentCommands],
          historyVersion: tab.historyVersion
        };
      }),
      newTab: vi.fn(async (input?: { title?: string; cwd?: string }) => {
        const tabId = `tab-${nextTabId++}`;
        if (!defaultTabId) {
          defaultTabId = tabId;
        }
        const tab = {
          tabId,
          title: input?.title ?? 'Terminal',
          cwd: input?.cwd ?? '',
          status: 'idle' as const,
          isDefault: false,
          lastActiveAt: new Date().toISOString(),
          recentCommands: [],
          content: '',
          historyVersion: 0
        };
        tabs.push(tab);
        syncDefaultFlags();
        return {
          tabId: tab.tabId,
          title: tab.title,
          cwd: tab.cwd,
          status: tab.status,
          isDefault: tab.isDefault,
          lastActiveAt: tab.lastActiveAt,
          recentCommands: [...tab.recentCommands]
        };
      }),
      closeTab: vi.fn(async (tabId: string) => {
        const index = tabs.findIndex((tab) => tab.tabId === tabId);
        if (index >= 0) {
          tabs.splice(index, 1);
          if (defaultTabId === tabId) {
            defaultTabId = null;
          }
          syncDefaultFlags();
        }

        return {
          tabs: tabs.map(({ content: _content, historyVersion: _historyVersion, ...tab }) => ({ ...tab })),
          defaultTabId
        };
      }),
      execute: vi.fn(async (input: { command: string; cwd?: string; tabId?: string }) => {
        let tab = input.tabId ? tabs.find((item) => item.tabId === input.tabId) : tabs.find((item) => item.tabId === defaultTabId);
        if (!tab) {
          const created = await executor.terminal.newTab({ cwd: input.cwd ?? '/workspace/demo' });
          const createdTab = tabs.find((item) => item.tabId === created.tabId);
          if (!createdTab) {
            throw new Error(`Failed to create terminal tab: ${created.tabId}`);
          }
          tab = createdTab;
        }

        tab.cwd = input.cwd ?? (tab.cwd || '/workspace/demo');
        tab.recentCommands.push(input.command);
        tab.content += `$ ${input.command}\n${tab.cwd}\n`;
        tab.historyVersion += 1;
        tab.lastActiveAt = new Date().toISOString();

        return {
          tabId: tab.tabId,
          command: input.command,
          cwd: tab.cwd,
          exitCode: 0,
          stdout: `${tab.cwd}\n`,
          stderr: '',
          combinedOutput: `${tab.cwd}\n`,
          timedOut: false
        };
      }),
      startExecution: vi.fn(async (input: { command: string; cwd?: string; tabId?: string }) => {
        let tab = input.tabId ? tabs.find((item) => item.tabId === input.tabId) : tabs.find((item) => item.tabId === defaultTabId);
        if (!tab) {
          const created = await executor.terminal.newTab({ cwd: input.cwd ?? '/workspace/demo' });
          const createdTab = tabs.find((item) => item.tabId === created.tabId);
          if (!createdTab) {
            throw new Error(`Failed to create terminal tab: ${created.tabId}`);
          }
          tab = createdTab;
        }

        tab.cwd = input.cwd ?? (tab.cwd || '/workspace/demo');
        const now = new Date().toISOString();
        const executionId = `exec-${nextExecutionId++}`;
        const output = `${tab.cwd}\n`;
        const snapshot = {
          executionId,
          tabId: tab.tabId,
          command: input.command,
          cwd: tab.cwd,
          status: 'completed' as const,
          createdAt: now,
          startedAt: now,
          finishedAt: now,
          exitCode: 0,
          timedOut: false,
          error: null
        };
        executions.set(executionId, {
          snapshot,
          output: {
            executionId,
            tabId: tab.tabId,
            command: input.command,
            cwd: tab.cwd,
            stdout: output,
            stderr: '',
            combinedOutput: output,
            exitCode: 0,
            timedOut: false,
            finishedAt: now
          }
        });

        return snapshot;
      }),
      getExecution: vi.fn((executionId: string) => {
        const execution = executions.get(executionId);
        return execution ? { ...execution.snapshot } : null;
      }),
      getExecutionOutput: vi.fn((executionId: string) => {
        const execution = executions.get(executionId);
        return execution?.output ? { ...execution.output } : null;
      }),
      cancelExecution: vi.fn((executionId: string) => {
        const existing = executions.get(executionId);
        if (!existing) {
          return false;
        }

        existing.snapshot.status = 'cancelled';
        existing.snapshot.error = '执行已取消';
        existing.snapshot.finishedAt = new Date().toISOString();
        existing.output = null;
        executions.set(executionId, existing);
        return true;
      })
    }
  };

  return createMcpRouter({
    executor: executor as never,
    path: options.path
  });
}

describe('mcp router', () => {
  it('returns mcp endpoint metadata on GET /mcp', async () => {
    const router = createRouterForTest();
    const response = await router.handle({
      method: 'GET',
      url: '/mcp',
      headers: {},
      body: new Uint8Array()
    });

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe('*');
    expect(response.jsonBody).toMatchObject({
      name: 'vscode-filesystem-ext-mcp',
      transport: 'streamable-http',
      endpoint: '/mcp'
    });
  });

  it('returns 405 for GET /mcp when the client requests an SSE stream', async () => {
    const router = createRouterForTest();

    const response = await router.handle({
      method: 'GET',
      url: '/mcp',
      headers: { accept: 'text/event-stream' },
      body: new Uint8Array()
    });

    expect(response.status).toBe(405);
    expect(response.headers.allow).toBe('POST, OPTIONS');
    expect(response.headers['mcp-protocol-version']).toBe('2025-11-25');
    expect(response.body.byteLength).toBe(0);
  });

  it('supports configured MCP path and CORS preflight', async () => {
    const router = createRouterForTest({ path: '/gateway-mcp' });

    const preflight = await router.handle({
      method: 'OPTIONS',
      url: '/gateway-mcp',
      headers: {},
      body: new Uint8Array()
    });
    const metadata = await router.handle({
      method: 'GET',
      url: '/gateway-mcp',
      headers: {},
      body: new Uint8Array()
    });

    expect(preflight.status).toBe(204);
    expect(preflight.headers['access-control-allow-methods']).toContain('POST');
    expect(metadata.status).toBe(200);
    expect(metadata.jsonBody).toMatchObject({ endpoint: '/gateway-mcp' });
  });

  it('accepts legacy /mcp and trailing-slash variants for compatibility', async () => {
    const router = createRouterForTest({ path: '/gateway-mcp/' });

    const legacy = await router.handle({
      method: 'GET',
      url: '/mcp',
      headers: {},
      body: new Uint8Array()
    });
    const trailingSlash = await router.handle({
      method: 'GET',
      url: '/gateway-mcp/',
      headers: {},
      body: new Uint8Array()
    });

    expect(legacy.status).toBe(200);
    expect(trailingSlash.status).toBe(200);
    expect(trailingSlash.jsonBody).toMatchObject({ endpoint: '/gateway-mcp' });
  });

  it('supports initialize and tools/list JSON-RPC methods', async () => {
    const router = createRouterForTest();

    const initializeResponse = await router.handle({
      method: 'POST',
      url: '/mcp',
      headers: { 'content-type': 'application/json' },
      body: new TextEncoder().encode(JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {}
      }))
    });

    expect(initializeResponse.status).toBe(200);
    expect(initializeResponse.jsonBody).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: {
        capabilities: {
          tools: {}
        }
      }
    });

    const listResponse = await router.handle({
      method: 'POST',
      url: '/mcp',
      headers: { 'content-type': 'application/json' },
      body: new TextEncoder().encode(JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list'
      }))
    });

    expect(listResponse.status).toBe(200);
    expect(listResponse.jsonBody).toMatchObject({
      jsonrpc: '2.0',
      id: 2,
      result: {
        tools: expect.arrayContaining([
          expect.objectContaining({ name: 'list_workspaces' }),
          expect.objectContaining({ name: 'listWorkspaces' }),
          expect.objectContaining({ name: 'create_file' }),
          expect.objectContaining({ name: 'find_files' }),
          expect.objectContaining({ name: 'search_text' }),
          expect.objectContaining({ name: 'read_json_file' }),
          expect.objectContaining({ name: 'apply_text_edits' }),
          expect.objectContaining({ name: 'get_diagnostics' }),
          expect.objectContaining({ name: 'get_definition' }),
          expect.objectContaining({ name: 'find_references' }),
          expect.objectContaining({ name: 'get_document_symbols' }),
          expect.objectContaining({ name: 'get_workspace_symbols' }),
          expect.objectContaining({ name: 'get_hover' }),
          expect.objectContaining({ name: 'get_code_actions' }),
          expect.objectContaining({ name: 'prepare_rename' }),
          expect.objectContaining({ name: 'get_rename_edits' }),
          expect.objectContaining({ name: 'directory_tree' }),
          expect.objectContaining({ name: 'apply_patch' }),
          expect.objectContaining({ name: 'get_active_editor' }),
          expect.objectContaining({ name: 'list_open_documents' }),
          expect.objectContaining({ name: 'get_format_edits' }),
          expect.objectContaining({
            name: 'createFile',
            inputSchema: expect.objectContaining({
              properties: expect.objectContaining({
                path: expect.objectContaining({ description: expect.stringContaining('相对 workspaceId 根目录') })
              })
            })
          }),
          expect.objectContaining({ name: 'new_terminal_tab' }),
          expect.objectContaining({ name: 'terminalExecute' }),
          expect.objectContaining({ name: 'terminal_execute' }),
          expect.objectContaining({ name: 'start_terminal_execution' }),
          expect.objectContaining({ name: 'cancelTerminalExecution' })
        ])
      }
    });

    const tools = ((listResponse.jsonBody as { result: { tools: Array<{ name: string; description: string }> } }).result.tools);
    expect(tools.find((tool) => tool.name === 'terminal_execute')?.description).toContain('timeoutMs（默认 120000）');
    expect(tools.find((tool) => tool.name === 'terminal_execute')?.description).toContain('shellIntegrationWaitMs（默认 30000，可提到 60000）');
    expect(tools.find((tool) => tool.name === 'read_text_file')).toMatchObject({
      inputSchema: expect.objectContaining({
        properties: expect.objectContaining({
          offset: expect.objectContaining({ type: 'number' }),
          limit: expect.objectContaining({ type: 'number' }),
          withLineNumbers: expect.objectContaining({ type: 'boolean' })
        })
      })
    });
  });

  it('supports sliced read_text_file results for models that need partial reads', async () => {
    const router = createRouterForTest();

    const response = await router.handle({
      method: 'POST',
      url: '/mcp',
      headers: { 'content-type': 'application/json' },
      body: new TextEncoder().encode(JSON.stringify({
        jsonrpc: '2.0',
        id: 200,
        method: 'tools/call',
        params: {
          name: 'read_text_file',
          arguments: {
            workspaceId: 'ws_demo',
            path: 'src/notes.txt',
            offset: 2,
            limit: 2,
            withLineNumbers: true
          }
        }
      }))
    });

    expect(response.status).toBe(200);
    expect(response.jsonBody).toMatchObject({
      jsonrpc: '2.0',
      id: 200,
      result: {
        structuredContent: {
          content: '2: beta\n3: gamma',
          slice: {
            offset: 2,
            limit: 2,
            totalLines: 5,
            returnedLineStart: 2,
            returnedLineEnd: 3,
            truncated: true,
            withLineNumbers: true,
            nextOffset: 4
          }
        }
      }
    });
  });

  it('supports paged list_directory results for large directories', async () => {
    const router = createRouterForTest();

    const result = await callTool<{
      items: Array<{ path: string }>;
      offset: number;
      limit: number;
      totalItems: number;
      truncated: boolean;
    }>(router, 'list_directory', {
      workspaceId: 'ws_demo',
      path: 'src',
      offset: 2,
      limit: 1
    });

    expect(result).toMatchObject({
      offset: 2,
      limit: 1,
      totalItems: 3,
      truncated: true
    });
    expect(result.items).toEqual([
      expect.objectContaining({ path: 'src/notes.txt' })
    ]);
  });

  it('supports partial read_binary_file results for large payloads', async () => {
    const router = createRouterForTest();

    const result = await callTool<{
      contentBase64: string;
      offset: number;
      limit: number;
      totalBytes: number;
      truncated: boolean;
    }>(router, 'read_binary_file', {
      workspaceId: 'ws_demo',
      path: 'assets/logo.bin',
      offset: 3,
      limit: 4
    });

    expect(result).toMatchObject({
      offset: 3,
      limit: 4,
      totalBytes: 10,
      truncated: true,
      contentBase64: Buffer.from(Uint8Array.from([50, 51, 52, 53])).toString('base64')
    });
  });

  it('finds files recursively without needing shell glob commands', async () => {
    const router = createRouterForTest();

    const result = await callTool<{
      matches: Array<{ path: string }>;
      offset: number;
      limit: number;
      totalMatches: number;
      truncated: boolean;
    }>(router, 'find_files', {
      workspaceId: 'ws_demo',
      pattern: 'src/*.ts',
      offset: 2,
      limit: 1
    });

    expect(result).toMatchObject({ offset: 2, limit: 1, totalMatches: 2, truncated: true });
    expect(result.matches).toEqual([expect.objectContaining({ path: 'src/utils.ts' })]);
  });

  it('searches text across files without needing grep in terminal', async () => {
    const router = createRouterForTest();

    const result = await callTool<{
      matches: Array<{ path: string; lineNumber: number; lineText: string }>;
      offset: number;
      limit: number;
      totalMatches: number;
      truncated: boolean;
    }>(router, 'search_text', {
      workspaceId: 'ws_demo',
      query: 'hello',
      offset: 2,
      limit: 1
    });

    expect(result).toMatchObject({ offset: 2, limit: 1, totalMatches: 2, truncated: true });
    expect(result.matches).toEqual([
      expect.objectContaining({ path: 'src/app.ts', lineNumber: 2, lineText: '  return "hello";' })
    ]);
  });

  it('supports path filtering and custom context size for search_text', async () => {
    const router = createRouterForTest();

    const result = await callTool<{
      matches: Array<{ path: string; context: string }>;
      totalMatches: number;
    }>(router, 'search_text', {
      workspaceId: 'ws_demo',
      query: 'hello',
      pathPattern: 'src/app.ts',
      contextLines: 0
    });

    expect(result.totalMatches).toBe(2);
    expect(result.matches[0]).toMatchObject({
      path: 'src/app.ts',
      context: '1: export function hello() {'
    });
  });

  it('returns a directory tree view without needing tree command', async () => {
    const router = createRouterForTest();

    const result = await callTool<{ content: string; totalItems: number }>(router, 'directory_tree', {
      workspaceId: 'ws_demo',
      path: '',
      maxDepth: 2
    });

    expect(result.totalItems).toBeGreaterThanOrEqual(4);
    expect(result.content).toContain('1: config/');
    expect(result.content).toContain('2:   settings.json');
    expect(result.content).toContain('3: src/');
  });

  it('reads nested JSON values without needing jq', async () => {
    const router = createRouterForTest();

    const result = await callTool<{ value: boolean; query: string }>(router, 'read_json_file', {
      workspaceId: 'ws_demo',
      path: 'config/settings.json',
      query: 'compilerOptions.strict'
    });

    expect(result).toMatchObject({ value: true, query: 'compilerOptions.strict' });
  });

  it('applies structured text edits without needing shell patch commands', async () => {
    const router = createRouterForTest();

    const patched = await callTool<{ appliedEdits: number; path: string }>(router, 'apply_text_edits', {
      workspaceId: 'ws_demo',
      path: 'src/app.ts',
      edits: [
        {
          oldText: 'return "hello";',
          newText: 'return "hello world";'
        }
      ]
    });

    const reread = await callTool<{ content: string }>(router, 'read_text_file', {
      workspaceId: 'ws_demo',
      path: 'src/app.ts'
    });

    expect(patched).toMatchObject({ appliedEdits: 1, path: 'src/app.ts' });
    expect(reread.content).toContain('return "hello world";');
  });

  it('returns diagnostics through MCP without terminal fallback', async () => {
    const router = createRouterForTest();

    const result = await callTool<{ items: Array<{ path: string; severity: string; range: { start: { line: number } } }> }>(router, 'get_diagnostics', {
      workspaceId: 'ws_demo',
      path: 'src/app.ts'
    });

    expect(result.items).toEqual([
      expect.objectContaining({ path: 'src/app.ts', severity: 'warning', range: { start: { line: 2, character: 3 }, end: { line: 2, character: 9 } } })
    ]);
  });

  it('returns definition locations through MCP', async () => {
    const router = createRouterForTest();

    const result = await callTool<{ items: Array<{ path: string; range: { start: { line: number } } }> }>(router, 'get_definition', {
      workspaceId: 'ws_demo',
      path: 'src/app.ts',
      line: 2,
      character: 10
    });

    expect(result.items).toEqual([
      expect.objectContaining({ path: 'src/app.ts', range: { start: { line: 1, character: 1 }, end: { line: 1, character: 8 } } })
    ]);
  });

  it('returns references through MCP', async () => {
    const router = createRouterForTest();

    const result = await callTool<{ items: Array<{ path: string }> }>(router, 'find_references', {
      workspaceId: 'ws_demo',
      path: 'src/app.ts',
      line: 2,
      character: 10
    });

    expect(result.items).toEqual([
      expect.objectContaining({ path: 'src/app.ts' }),
      expect.objectContaining({ path: 'src/utils.ts' })
    ]);
  });

  it('returns document symbols through MCP', async () => {
    const router = createRouterForTest();

    const result = await callTool<{ items: Array<{ name: string; path: string }> }>(router, 'get_document_symbols', {
      workspaceId: 'ws_demo',
      path: 'src/app.ts'
    });

    expect(result.items).toEqual([
      expect.objectContaining({ name: 'hello', path: 'src/app.ts' })
    ]);
  });

  it('returns workspace symbols through MCP', async () => {
    const router = createRouterForTest();

    const result = await callTool<{ items: Array<{ name: string; path: string }> }>(router, 'get_workspace_symbols', {
      workspaceId: 'ws_demo',
      query: 'hello'
    });

    expect(result.items).toEqual([
      expect.objectContaining({ name: 'hello', path: 'src/app.ts' })
    ]);
  });

  it('returns hover information through MCP', async () => {
    const router = createRouterForTest();

    const result = await callTool<{ items: Array<{ path: string; contents: string }> }>(router, 'get_hover', {
      workspaceId: 'ws_demo',
      path: 'src/app.ts',
      line: 1,
      character: 17
    });

    expect(result.items).toEqual([
      expect.objectContaining({ path: 'src/app.ts', contents: '```ts\nfunction hello(): string\n```' })
    ]);
  });

  it('returns current active editor through MCP', async () => {
    const router = createRouterForTest();

    const result = await callTool<{ path: string; languageId: string; selections: Array<unknown> }>(router, 'get_active_editor', {});

    expect(result).toMatchObject({ path: 'src/app.ts', languageId: 'typescript' });
    expect(result.selections).toHaveLength(1);
  });

  it('returns open documents through MCP', async () => {
    const router = createRouterForTest();

    const result = await callTool<{ items: Array<{ path: string }> }>(router, 'list_open_documents', {});

    expect(result.items).toEqual([
      expect.objectContaining({ path: 'src/app.ts' }),
      expect.objectContaining({ path: 'config/settings.json' })
    ]);
  });

  it('returns code actions through MCP', async () => {
    const router = createRouterForTest();

    const result = await callTool<{ items: Array<{ title: string; kind: string }> }>(router, 'get_code_actions', {
      workspaceId: 'ws_demo',
      path: 'src/app.ts',
      line: 1,
      character: 17
    });

    expect(result.items).toEqual([
      expect.objectContaining({ title: 'Add explicit return type', kind: 'quickfix' })
    ]);
  });

  it('returns rename preparation data through MCP', async () => {
    const router = createRouterForTest();

    const result = await callTool<{ placeholder: string; range: { start: { line: number } } }>(router, 'prepare_rename', {
      workspaceId: 'ws_demo',
      path: 'src/app.ts',
      line: 1,
      character: 17
    });

    expect(result).toMatchObject({ placeholder: 'hello', range: { start: { line: 1, character: 17 } } });
  });

  it('returns rename edit set through MCP', async () => {
    const router = createRouterForTest();

    const result = await callTool<{ changes: Array<{ path: string }> }>(router, 'get_rename_edits', {
      workspaceId: 'ws_demo',
      path: 'src/app.ts',
      line: 1,
      character: 17,
      newName: 'greet'
    });

    expect(result.changes).toEqual([
      expect.objectContaining({ path: 'src/app.ts' }),
      expect.objectContaining({ path: 'src/utils.ts' })
    ]);
  });

  it('returns format edit preview through MCP', async () => {
    const router = createRouterForTest();

    const result = await callTool<{ changes: Array<{ path: string }> }>(router, 'get_format_edits', {
      workspaceId: 'ws_demo',
      path: 'src/app.ts'
    });

    expect(result.changes).toEqual([
      expect.objectContaining({ path: 'src/app.ts' })
    ]);
  });

  it('applies simplified patch text through MCP', async () => {
    const router = createRouterForTest();

    const result = await callTool<{ updatedFiles: Array<string> }>(router, 'apply_patch', {
      workspaceId: 'ws_demo',
      patch: ['*** Begin Patch', '*** Update File: src/app.ts', '@@', '-  return "hello";', '+  return "patched";', '*** End Patch'].join('\n')
    });

    const reread = await callTool<{ content: string }>(router, 'read_text_file', {
      workspaceId: 'ws_demo',
      path: 'src/app.ts'
    });

    expect(result.updatedFiles).toEqual(['src/app.ts']);
    expect(reread.content).toContain('patched');
  });

  it('exposes file mutation, export job, and terminal tools', async () => {
    const router = createRouterForTest();

    const fileResponse = await router.handle({
      method: 'POST',
      url: '/mcp',
      headers: { 'content-type': 'application/json' },
      body: new TextEncoder().encode(JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'create_file',
          arguments: { workspaceId: 'ws_demo', path: 'src/new.ts' }
        }
      }))
    });

    expect(fileResponse.status).toBe(200);
    expect(fileResponse.jsonBody).toMatchObject({
      jsonrpc: '2.0',
      id: 3,
      result: {
        structuredContent: {
          created: true,
          path: 'src/new.ts'
        }
      }
    });

    const exportResponse = await router.handle({
      method: 'POST',
      url: '/mcp',
      headers: { 'content-type': 'application/json' },
      body: new TextEncoder().encode(JSON.stringify({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'start_export_job',
          arguments: {
            workspaceId: 'ws_demo',
            format: 'archive',
            paths: ['src']
          }
        }
      }))
    });

    expect(exportResponse.status).toBe(200);
    expect(exportResponse.jsonBody).toMatchObject({
      jsonrpc: '2.0',
      id: 4,
      result: {
        structuredContent: {
          jobId: 'job-1'
        }
      }
    });

    const terminalResponse = await router.handle({
      method: 'POST',
      url: '/mcp',
      headers: { 'content-type': 'application/json' },
      body: new TextEncoder().encode(JSON.stringify({
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: {
          name: 'terminal_execute',
          arguments: { workspaceId: 'ws_demo', command: 'pwd' }
        }
      }))
    });

    expect(terminalResponse.status).toBe(200);
    expect(terminalResponse.jsonBody).toMatchObject({
      jsonrpc: '2.0',
      id: 5,
      result: {
        structuredContent: {
          tabId: 'tab-1',
          command: 'pwd',
          exitCode: 0,
          stdout: '/workspace/demo\n'
        }
      }
    });
  });

  it('accepts camelCase aliases for file and terminal tools', async () => {
    const router = createRouterForTest();

    const createFileResult = await callTool<Record<string, unknown>>(router, 'createFile', {
      workspaceId: 'ws_demo',
      path: 'test.txt'
    });
    const terminalResult = await callTool<Record<string, unknown>>(router, 'terminalExecute', {
      workspaceId: 'ws_demo',
      command: 'pwd'
    });

    expect(createFileResult).toMatchObject({ created: true, path: 'test.txt' });
    expect(terminalResult).toMatchObject({ tabId: 'tab-1', command: 'pwd' });
  });

  it('creates and lists terminal tabs through MCP', async () => {
    const router = createRouterForTest();

    const created = await callTool<Record<string, unknown>>(router, 'new_terminal_tab', {
      title: 'Ubuntu',
      cwdPath: 'src',
      workspaceId: 'ws_demo'
    });
    const listed = await callTool<{ defaultTabId: string | null; tabs: Array<Record<string, unknown>> }>(router, 'list_terminal_tabs', {});

    expect(created.tabId).toBe('tab-1');
    expect(created.title).toBe('Ubuntu');
    expect(created.cwd).toBe('/workspace/demo/src');
    expect(listed.defaultTabId).toBe('tab-1');
    expect(listed.tabs).toHaveLength(1);
    expect(listed.tabs[0]).toMatchObject({ tabId: 'tab-1', title: 'Ubuntu', isDefault: true });
  });

  it('shows terminal tab history content through MCP', async () => {
    const router = createRouterForTest();

    await callTool(router, 'new_terminal_tab', { title: 'Ubuntu', workspaceId: 'ws_demo' });
    await callTool(router, 'terminal_execute', { tabId: 'tab-1', command: 'pwd' });
    const content = await callTool<Record<string, unknown>>(router, 'show_terminal_tab_content', { tabId: 'tab-1' });

    expect(content).toMatchObject({
      tabId: 'tab-1',
      title: 'Ubuntu',
      historyVersion: 1,
      recentCommands: ['pwd']
    });
    expect(content.content).toContain('$ pwd');
    expect(content.content).toContain('/workspace/demo');
  });

  it('starts, gets, reads output, and cancels terminal executions through MCP tools', async () => {
    const router = createRouterForTest();

    const created = await callTool<Record<string, unknown>>(router, 'new_terminal_tab', { workspaceId: 'ws_demo' });
    const started = await callTool<Record<string, unknown>>(router, 'start_terminal_execution', {
      workspaceId: 'ws_demo',
      tabId: String(created.tabId),
      command: 'pwd'
    });

    const executionId = String(started.executionId);
    const snapshot = await callTool<Record<string, unknown>>(router, 'get_terminal_execution', { executionId });
    const output = await callTool<Record<string, unknown> | null>(router, 'get_terminal_execution_output', { executionId });
    const cancelled = await callTool<Record<string, unknown>>(router, 'cancel_terminal_execution', { executionId });

    expect(started).toMatchObject({ executionId: expect.any(String), command: 'pwd' });
    expect(snapshot).toMatchObject({ executionId, status: 'completed' });
    expect(output).toMatchObject({ executionId, stdout: '/workspace/demo\n' });
    expect(cancelled).toEqual({ executionId, cancelled: true });
  });

  it('returns text-only MCP tool results when terminal execution output is still unavailable', async () => {
    const router = createRouterForTest();

    const started = await callTool<Record<string, unknown>>(router, 'start_terminal_execution', {
      workspaceId: 'ws_demo',
      command: 'sleep'
    });
    const executionId = String(started.executionId);

    const response = await router.handle({
      method: 'POST',
      url: '/mcp',
      headers: { 'content-type': 'application/json' },
      body: new TextEncoder().encode(JSON.stringify({
        jsonrpc: '2.0',
        id: 1001,
        method: 'tools/call',
        params: {
          name: 'get_terminal_execution_output',
          arguments: { executionId: `pending-${executionId}` }
        }
      }))
    });

    expect(response.status).toBe(200);
    expect(response.jsonBody).toMatchObject({
      result: {
        content: [{ type: 'text', text: 'null' }]
      }
    });
    expect((response.jsonBody as { result: Record<string, unknown> }).result).not.toHaveProperty('structuredContent');
  });

  it('accepts notifications/initialized without returning a JSON-RPC error', async () => {
    const router = createRouterForTest();

    const response = await router.handle({
      method: 'POST',
      url: '/mcp',
      headers: { 'content-type': 'application/json' },
      body: new TextEncoder().encode(JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/initialized'
      }))
    });

    expect(response.status).toBe(202);
    expect(response.body.byteLength).toBe(0);
    expect(response.jsonBody).toBeUndefined();
  });

  it('supports lightweight MCP methods often called during client handshake', async () => {
    const router = createRouterForTest();

    const ping = await callMethod(router, 'ping');
    const prompts = await callMethod(router, 'prompts/list');
    const resources = await callMethod(router, 'resources/list');
    const templates = await callMethod(router, 'resources/templates/list');

    expect(ping).toEqual({});
    expect(prompts).toEqual({ prompts: [] });
    expect(resources).toEqual({ resources: [] });
    expect(templates).toEqual({ resourceTemplates: [] });
  });

  it('handles JSON-RPC batch requests', async () => {
    const router = createRouterForTest();

    const response = await router.handle({
      method: 'POST',
      url: '/mcp',
      headers: { 'content-type': 'application/json' },
      body: new TextEncoder().encode(JSON.stringify([
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
        { jsonrpc: '2.0', id: 2, method: 'tools/list' }
      ]))
    });

    expect(response.status).toBe(200);
    const body = response.jsonBody as Array<{ id: number; result?: unknown; error?: unknown }>;
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(2);
    expect(body[0]).toMatchObject({ id: 1 });
    expect(body[1]).toMatchObject({ id: 2 });
  });
});

async function callTool<T>(router: ReturnType<typeof createMcpRouter>, name: string, args: Record<string, unknown>): Promise<T> {
  const response = await router.handle({
    method: 'POST',
    url: '/mcp',
    headers: { 'content-type': 'application/json' },
    body: new TextEncoder().encode(JSON.stringify({
      jsonrpc: '2.0',
      id: 900,
      method: 'tools/call',
      params: { name, arguments: args }
    }))
  });

  expect(response.status).toBe(200);
  return (response.jsonBody as { result: { structuredContent?: T } }).result.structuredContent as T;
}

async function callMethod<T>(router: ReturnType<typeof createMcpRouter>, method: string): Promise<T> {
  const response = await router.handle({
    method: 'POST',
    url: '/mcp',
    headers: { 'content-type': 'application/json' },
    body: new TextEncoder().encode(JSON.stringify({
      jsonrpc: '2.0',
      id: 901,
      method,
      params: {}
    }))
  });

  expect(response.status).toBe(200);
  return (response.jsonBody as { result: T }).result;
}
