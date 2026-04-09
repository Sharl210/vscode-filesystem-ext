import { describe, expect, it } from 'vitest';
import type {
  ConnectionInfoDto,
  ExportJobSnapshotDto,
  FileEntryDto,
  GetFileResponseDto,
  InitialLocationDto,
  WorkspaceItemDto
} from '../../src/types/api';

describe('local gateway executor', () => {
  it('adapts local read-only context behind the executor contract', async () => {
    const { createLocalGatewayExecutor } = await loadLocalGatewayExecutorModule();
    const calls: Array<{ method: string; args: unknown[] }> = [];
    const workspaces: WorkspaceItemDto[] = [
      {
        id: 'ws_demo',
        name: 'demo',
        uri: 'file:///workspace/demo',
        source: 'workspace'
      }
    ];
    const initialLocation: InitialLocationDto = {
      rootId: 'ws_demo',
      path: 'src',
      activeFilePath: 'src/index.ts',
      expandedPaths: ['', 'src']
    };
    const connectionInfo: ConnectionInfoDto = {
      kind: 'remote',
      label: '远程 · ssh-remote · demo',
      host: 'demo-host',
      remoteName: 'ssh-remote',
      authority: 'ssh-remote+demo'
    };

    const executor = createLocalGatewayExecutor({
      reads: {
        getWorkspaces(...args) {
          calls.push({ method: 'getWorkspaces', args });
          return workspaces;
        },
        getInitialLocation(...args) {
          calls.push({ method: 'getInitialLocation', args });
          return initialLocation;
        },
        getConnectionInfo(...args) {
          calls.push({ method: 'getConnectionInfo', args });
          return connectionInfo;
        },
        getWorkspaceById(...args) {
          calls.push({ method: 'getWorkspaceById', args });
          return workspaces[0];
        },
        resolveWorkspacePath(...args) {
          calls.push({ method: 'resolveWorkspacePath', args });
          return 'file:///workspace/demo/src/index.ts';
        }
      },
      fileService: {
        async listDirectory() {
          throw new Error('not used');
        },
        async readTextFile() {
          throw new Error('not used');
        },
        async readBinaryFile() {
          throw new Error('not used');
        },
        async exportArchive() {
          throw new Error('not used');
        },
        async exportDisguisedImage() {
          throw new Error('not used');
        },
        async writeFileBytes() {
          throw new Error('not used');
        },
        async writeTextFile() {
          throw new Error('not used');
        },
        async deleteEntry() {
          throw new Error('not used');
        },
        async createDirectory() {
          throw new Error('not used');
        },
        async renameEntry() {
          throw new Error('not used');
        },
        async copyEntry() {
          throw new Error('not used');
        }
      },
      exportJobs: {
        startJob() {
          throw new Error('not used');
        },
        getJob() {
          throw new Error('not used');
        },
        getDownload() {
          throw new Error('not used');
        },
        cancelJob() {
          throw new Error('not used');
        }
      },
      terminal: {
        async execute() {
          throw new Error('not used');
        }
      }
    });

    expect(executor.reads.getWorkspaces()).toBe(workspaces);
    expect(executor.reads.getInitialLocation()).toBe(initialLocation);
    expect(executor.reads.getConnectionInfo()).toBe(connectionInfo);
    expect(executor.reads.getWorkspaceById('ws_demo')).toBe(workspaces[0]);
    expect(executor.reads.resolveWorkspacePath('file:///workspace/demo', 'src/index.ts')).toBe('file:///workspace/demo/src/index.ts');

    expect(calls).toEqual([
      { method: 'getWorkspaces', args: [] },
      { method: 'getInitialLocation', args: [] },
      { method: 'getConnectionInfo', args: [] },
      { method: 'getWorkspaceById', args: ['ws_demo'] },
      { method: 'resolveWorkspacePath', args: ['file:///workspace/demo', 'src/index.ts'] }
    ]);
  });

  it('adapts local file operations behind the executor contract', async () => {
    const { createLocalGatewayExecutor } = await loadLocalGatewayExecutorModule();
    const calls: Array<{ method: string; args: unknown[] }> = [];
    const directoryEntry: FileEntryDto = {
      name: 'hello.ts',
      path: 'src/hello.ts',
      type: 'file',
      size: 12,
      mtime: 42,
      mimeType: 'text/typescript',
      isText: true,
      downloadable: true
    };
    const directoryEntries: FileEntryDto[] = [directoryEntry];
    const textFile: GetFileResponseDto = {
      file: directoryEntry,
      content: 'export const hello = true;',
      encoding: 'utf-8',
      editable: true
    };
    const binaryFile = {
      data: Uint8Array.from([1, 2, 3]),
      mimeType: 'image/png',
      fileName: 'logo.png'
    };
    const archiveResult = {
      data: Uint8Array.from([4, 5, 6]),
      mimeType: 'application/x-tar',
      fileName: 'bundle.tar'
    };
    const disguisedImageResult = {
      data: Uint8Array.from([7, 8, 9]),
      mimeType: 'image/png',
      fileName: 'bundle.png'
    };

    const executor = createLocalGatewayExecutor({
      reads: createUnusedReadsStub(),
      fileService: {
        async listDirectory(...args) {
          calls.push({ method: 'listDirectory', args });
          return directoryEntries;
        },
        async readTextFile(...args) {
          calls.push({ method: 'readTextFile', args });
          return textFile;
        },
        async readBinaryFile(...args) {
          calls.push({ method: 'readBinaryFile', args });
          return binaryFile;
        },
        async exportArchive(...args) {
          calls.push({ method: 'exportArchive', args });
          return archiveResult;
        },
        async exportDisguisedImage(...args) {
          calls.push({ method: 'exportDisguisedImage', args });
          return disguisedImageResult;
        },
        async writeFileBytes(...args) {
          calls.push({ method: 'writeFileBytes', args });
        },
        async writeTextFile(...args) {
          calls.push({ method: 'writeTextFile', args });
        },
        async deleteEntry(...args) {
          calls.push({ method: 'deleteEntry', args });
        },
        async createDirectory(...args) {
          calls.push({ method: 'createDirectory', args });
        },
        async renameEntry(...args) {
          calls.push({ method: 'renameEntry', args });
        },
        async copyEntry(...args) {
          calls.push({ method: 'copyEntry', args });
        }
      },
      exportJobs: {
        startJob() {
          throw new Error('not used');
        },
        getJob() {
          throw new Error('not used');
        },
        getDownload() {
          throw new Error('not used');
        },
        cancelJob() {
          throw new Error('not used');
        }
      },
      terminal: {
        async execute(...args) {
          calls.push({ method: 'execute', args });
          return {
            command: 'pwd',
            cwd: '/workspace/demo',
            stdout: '/workspace/demo\n',
            stderr: '',
            combinedOutput: '/workspace/demo\n',
            exitCode: 0,
            timedOut: false
          };
        }
      }
    });

    await expect(executor.files.listDirectory('file:///workspace/demo', 'demo')).resolves.toBe(directoryEntries);
    await expect(executor.files.readTextFile('file:///workspace/demo/hello.ts', 'hello.ts')).resolves.toBe(textFile);
    await expect(executor.files.readBinaryFile('file:///workspace/demo/logo.png', 'logo.png')).resolves.toBe(binaryFile);
    await expect(executor.files.exportArchive([{ uri: 'file:///workspace/demo/hello.ts', path: 'hello.ts' }])).resolves.toBe(archiveResult);
    await expect(
      executor.files.exportDisguisedImage(
        [{ uri: 'file:///workspace/demo/hello.ts', path: 'hello.ts' }],
        'data:image/png;base64,AAAA'
      )
    ).resolves.toBe(disguisedImageResult);
    await expect(executor.files.writeFileBytes('file:///workspace/demo/raw.bin', Uint8Array.from([10]))).resolves.toBeUndefined();
    await expect(executor.files.uploadFile('file:///workspace/demo/upload.bin', Uint8Array.from([11, 12]))).resolves.toBeUndefined();
    await expect(executor.files.createFile('file:///workspace/demo/empty.txt')).resolves.toBeUndefined();
    await expect(executor.files.writeTextFile('file:///workspace/demo/hello.ts', 'updated')).resolves.toBeUndefined();
    await expect(executor.files.deleteEntry('file:///workspace/demo/hello.ts')).resolves.toBeUndefined();
    await expect(executor.files.createDirectory('file:///workspace/demo/new-folder')).resolves.toBeUndefined();
    await expect(executor.files.renameEntry('file:///workspace/demo/a', 'file:///workspace/demo/b')).resolves.toBeUndefined();
    await expect(executor.files.copyEntry('file:///workspace/demo/a', 'file:///workspace/demo/c')).resolves.toBeUndefined();
    await expect(executor.files.moveEntry('file:///workspace/demo/c', 'file:///workspace/demo/d')).resolves.toBeUndefined();
    await expect(executor.terminal.execute({ command: 'pwd', cwd: '/workspace/demo' })).resolves.toMatchObject({
      command: 'pwd',
      exitCode: 0
    });

    expect(calls).toEqual([
      { method: 'listDirectory', args: ['file:///workspace/demo', 'demo'] },
      { method: 'readTextFile', args: ['file:///workspace/demo/hello.ts', 'hello.ts'] },
      { method: 'readBinaryFile', args: ['file:///workspace/demo/logo.png', 'logo.png'] },
      { method: 'exportArchive', args: [[{ uri: 'file:///workspace/demo/hello.ts', path: 'hello.ts' }]] },
      {
        method: 'exportDisguisedImage',
        args: [[{ uri: 'file:///workspace/demo/hello.ts', path: 'hello.ts' }], 'data:image/png;base64,AAAA']
      },
      { method: 'writeFileBytes', args: ['file:///workspace/demo/raw.bin', Uint8Array.from([10])] },
      { method: 'writeFileBytes', args: ['file:///workspace/demo/upload.bin', Uint8Array.from([11, 12])] },
      { method: 'writeFileBytes', args: ['file:///workspace/demo/empty.txt', new Uint8Array()] },
      { method: 'writeTextFile', args: ['file:///workspace/demo/hello.ts', 'updated'] },
      { method: 'deleteEntry', args: ['file:///workspace/demo/hello.ts'] },
      { method: 'createDirectory', args: ['file:///workspace/demo/new-folder'] },
      { method: 'renameEntry', args: ['file:///workspace/demo/a', 'file:///workspace/demo/b'] },
      { method: 'copyEntry', args: ['file:///workspace/demo/a', 'file:///workspace/demo/c'] },
      { method: 'renameEntry', args: ['file:///workspace/demo/c', 'file:///workspace/demo/d'] },
      { method: 'execute', args: [{ command: 'pwd', cwd: '/workspace/demo' }] }
    ]);
  });

  it('adapts local export job operations behind the executor contract', async () => {
    const { createLocalGatewayExecutor } = await loadLocalGatewayExecutorModule();
    const calls: Array<{ method: string; args: unknown[] }> = [];
    const snapshot: ExportJobSnapshotDto = {
      jobId: 'job-1',
      status: 'running',
      format: 'archive',
      progress: 25,
      stage: 'collecting',
      currentMessage: '正在收集文件',
      messages: ['正在收集文件'],
      fileName: null,
      error: null
    };
    const download = {
      data: Uint8Array.from([1, 9, 9]),
      mimeType: 'application/x-tar',
      fileName: 'job-1.tar'
    };

    const executor = createLocalGatewayExecutor({
      reads: createUnusedReadsStub(),
      fileService: {
        async listDirectory() {
          throw new Error('not used');
        },
        async readTextFile() {
          throw new Error('not used');
        },
        async readBinaryFile() {
          throw new Error('not used');
        },
        async exportArchive() {
          throw new Error('not used');
        },
        async exportDisguisedImage() {
          throw new Error('not used');
        },
        async writeFileBytes() {
          throw new Error('not used');
        },
        async writeTextFile() {
          throw new Error('not used');
        },
        async deleteEntry() {
          throw new Error('not used');
        },
        async createDirectory() {
          throw new Error('not used');
        },
        async renameEntry() {
          throw new Error('not used');
        },
        async copyEntry() {
          throw new Error('not used');
        }
      },
      exportJobs: {
        startJob(...args) {
          calls.push({ method: 'startJob', args });
          return snapshot;
        },
        getJob(...args) {
          calls.push({ method: 'getJob', args });
          return snapshot;
        },
        getDownload(...args) {
          calls.push({ method: 'getDownload', args });
          return download;
        },
        cancelJob(...args) {
          calls.push({ method: 'cancelJob', args });
          return true;
        }
      },
      terminal: {
        async execute() {
          throw new Error('not used');
        }
      }
    });

    expect(
      executor.exports.startJob({ workspaceUri: 'file:///workspace/demo', paths: ['hello.ts'], format: 'archive' })
    ).toBe(snapshot);
    expect(executor.exports.getJob('job-1')).toBe(snapshot);
    expect(executor.exports.getDownload('job-1')).toBe(download);
    expect(executor.exports.consumeDownload('job-1')).toBe(download);
    expect(executor.exports.cancelJob('job-1')).toBe(true);

    expect(calls).toEqual([
      {
        method: 'startJob',
        args: [{ workspaceUri: 'file:///workspace/demo', paths: ['hello.ts'], format: 'archive' }]
      },
      { method: 'getJob', args: ['job-1'] },
      { method: 'getDownload', args: ['job-1'] },
      { method: 'getDownload', args: ['job-1'] },
      { method: 'cancelJob', args: ['job-1'] }
    ]);
  });
});

async function loadLocalGatewayExecutorModule() {
  let loadedModule: typeof import('../../src/executor/localGatewayExecutor.js') | undefined;
  let loadError: unknown;

  try {
    loadedModule = await import('../../src/executor/localGatewayExecutor.js');
  } catch (error) {
    loadError = error;
  }

  expect(loadError).toBeUndefined();
  expect(loadedModule?.createLocalGatewayExecutor).toBeTypeOf('function');

  if (!loadedModule) {
    throw new Error('local gateway executor module failed to load');
  }

  return loadedModule;
}

function createUnusedReadsStub() {
  return {
    getWorkspaces() {
      throw new Error('not used');
    },
    getInitialLocation() {
      throw new Error('not used');
    },
    getConnectionInfo() {
      throw new Error('not used');
    },
    getWorkspaceById() {
      throw new Error('not used');
    },
    resolveWorkspacePath() {
      throw new Error('not used');
    }
  };
}
