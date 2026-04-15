import type {
  GatewayExecutor,
  GatewayExportJobController,
  GatewayFileExecutor,
  GatewayLanguageExecutor,
  GatewayReadContextExecutor,
  GatewayReadTextFileOptions,
  GatewayTerminalManager
} from './contracts';

interface LocalGatewayFileServiceAdapter {
  listDirectory: GatewayFileExecutor['listDirectory'];
  readTextFile(fileUri: string, relativePath: string, options?: GatewayReadTextFileOptions): ReturnType<GatewayFileExecutor['readTextFile']>;
  readBinaryFile: GatewayFileExecutor['readBinaryFile'];
  exportArchive: GatewayFileExecutor['exportArchive'];
  exportDisguisedImage: GatewayFileExecutor['exportDisguisedImage'];
  writeFileBytes: GatewayFileExecutor['writeFileBytes'];
  writeTextFile: GatewayFileExecutor['writeTextFile'];
  deleteEntry: GatewayFileExecutor['deleteEntry'];
  createDirectory: GatewayFileExecutor['createDirectory'];
  renameEntry: GatewayFileExecutor['renameEntry'];
  copyEntry: GatewayFileExecutor['copyEntry'];
}

interface LocalGatewayExportJobsAdapter {
  startJob: GatewayExportJobController['startJob'];
  getJob: GatewayExportJobController['getJob'];
  getDownload: GatewayExportJobController['getDownload'];
  cancelJob: GatewayExportJobController['cancelJob'];
}

interface LocalGatewayTerminalAdapter {
  listTabs: GatewayTerminalManager['listTabs'];
  getTabContent: GatewayTerminalManager['getTabContent'];
  newTab: GatewayTerminalManager['newTab'];
  closeTab: GatewayTerminalManager['closeTab'];
  execute: GatewayTerminalManager['execute'];
  startExecution: GatewayTerminalManager['startExecution'];
  getExecution: GatewayTerminalManager['getExecution'];
  getExecutionOutput: GatewayTerminalManager['getExecutionOutput'];
  cancelExecution: GatewayTerminalManager['cancelExecution'];
}

interface LocalGatewayLanguageAdapter {
  getDiagnostics: GatewayLanguageExecutor['getDiagnostics'];
  getDefinition: GatewayLanguageExecutor['getDefinition'];
  findReferences: GatewayLanguageExecutor['findReferences'];
  getDocumentSymbols: GatewayLanguageExecutor['getDocumentSymbols'];
  getWorkspaceSymbols: GatewayLanguageExecutor['getWorkspaceSymbols'];
  getHover: GatewayLanguageExecutor['getHover'];
  getCodeActions: GatewayLanguageExecutor['getCodeActions'];
  prepareRename: GatewayLanguageExecutor['prepareRename'];
  getRenameEdits: GatewayLanguageExecutor['getRenameEdits'];
  getFormatEdits: GatewayLanguageExecutor['getFormatEdits'];
}

interface LocalGatewayExecutorDependencies {
  reads: GatewayReadContextExecutor;
  fileService: LocalGatewayFileServiceAdapter;
  exportJobs: LocalGatewayExportJobsAdapter;
  language: LocalGatewayLanguageAdapter;
  terminal: LocalGatewayTerminalAdapter;
}

class LocalGatewayExecutor implements GatewayExecutor {
  readonly reads: GatewayReadContextExecutor;
  readonly files: GatewayFileExecutor;
  readonly exports: GatewayExportJobController;
  readonly language: GatewayLanguageExecutor;
  readonly terminal: GatewayTerminalManager;

  constructor(dependencies: LocalGatewayExecutorDependencies) {
    this.reads = {
      getWorkspaces() {
        return dependencies.reads.getWorkspaces();
      },
      getInitialLocation() {
        return dependencies.reads.getInitialLocation();
      },
      getConnectionInfo() {
        return dependencies.reads.getConnectionInfo();
      },
      getActiveEditor() {
        return dependencies.reads.getActiveEditor();
      },
      listOpenDocuments() {
        return dependencies.reads.listOpenDocuments();
      },
      findFiles(input) {
        return dependencies.reads.findFiles(input);
      },
      getWorkspaceById(id) {
        return dependencies.reads.getWorkspaceById(id);
      },
      resolveWorkspacePath(workspaceUri, relativePath) {
        return dependencies.reads.resolveWorkspacePath(workspaceUri, relativePath);
      }
    };
    this.files = {
      listDirectory(directoryUri, directoryPath) {
        return dependencies.fileService.listDirectory(directoryUri, directoryPath);
      },
      readTextFile(fileUri, relativePath, options) {
        if (options) {
          return dependencies.fileService.readTextFile(fileUri, relativePath, options);
        }

        return dependencies.fileService.readTextFile(fileUri, relativePath);
      },
      readBinaryFile(fileUri, relativePath) {
        return dependencies.fileService.readBinaryFile(fileUri, relativePath);
      },
      exportArchive(entries, options) {
        if (options) {
          return dependencies.fileService.exportArchive(entries, options);
        }

        return dependencies.fileService.exportArchive(entries);
      },
      exportDisguisedImage(entries, imageDataUrl, options) {
        if (options) {
          return dependencies.fileService.exportDisguisedImage(entries, imageDataUrl, options);
        }

        return dependencies.fileService.exportDisguisedImage(entries, imageDataUrl);
      },
      uploadFile(fileUri, content) {
        return dependencies.fileService.writeFileBytes(fileUri, content);
      },
      createFile(fileUri) {
        return dependencies.fileService.writeFileBytes(fileUri, new Uint8Array());
      },
      writeFileBytes(fileUri, content) {
        return dependencies.fileService.writeFileBytes(fileUri, content);
      },
      writeTextFile(fileUri, content) {
        return dependencies.fileService.writeTextFile(fileUri, content);
      },
      deleteEntry(targetUri) {
        return dependencies.fileService.deleteEntry(targetUri);
      },
      createDirectory(targetUri) {
        return dependencies.fileService.createDirectory(targetUri);
      },
      renameEntry(fromUri, toUri) {
        return dependencies.fileService.renameEntry(fromUri, toUri);
      },
      copyEntry(fromUri, toUri) {
        return dependencies.fileService.copyEntry(fromUri, toUri);
      },
      moveEntry(fromUri, toUri) {
        return dependencies.fileService.renameEntry(fromUri, toUri);
      }
    };
    this.exports = {
      startJob(input) {
        return dependencies.exportJobs.startJob(input);
      },
      getJob(jobId) {
        return dependencies.exportJobs.getJob(jobId);
      },
      getDownload(jobId) {
        return dependencies.exportJobs.getDownload(jobId);
      },
      consumeDownload(jobId) {
        return dependencies.exportJobs.getDownload(jobId);
      },
      cancelJob(jobId) {
        return dependencies.exportJobs.cancelJob(jobId);
      }
    };
    this.language = {
      getDiagnostics(input) {
        return dependencies.language.getDiagnostics(input);
      },
      getDefinition(input) {
        return dependencies.language.getDefinition(input);
      },
      findReferences(input) {
        return dependencies.language.findReferences(input);
      },
      getDocumentSymbols(input) {
        return dependencies.language.getDocumentSymbols(input);
      },
      getWorkspaceSymbols(input) {
        return dependencies.language.getWorkspaceSymbols(input);
      },
      getHover(input) {
        return dependencies.language.getHover(input);
      },
      getCodeActions(input) {
        return dependencies.language.getCodeActions(input);
      },
      prepareRename(input) {
        return dependencies.language.prepareRename(input);
      },
      getRenameEdits(input) {
        return dependencies.language.getRenameEdits(input);
      },
      getFormatEdits(input) {
        return dependencies.language.getFormatEdits(input);
      }
    };
    this.terminal = {
      listTabs() {
        return dependencies.terminal.listTabs();
      },
      getTabContent(tabId) {
        return dependencies.terminal.getTabContent(tabId);
      },
      newTab(input) {
        return dependencies.terminal.newTab(input);
      },
      closeTab(tabId, input) {
        return dependencies.terminal.closeTab(tabId, input);
      },
      execute(input) {
        return dependencies.terminal.execute(input);
      },
      startExecution(input) {
        return dependencies.terminal.startExecution(input);
      },
      getExecution(executionId) {
        return dependencies.terminal.getExecution(executionId);
      },
      getExecutionOutput(executionId) {
        return dependencies.terminal.getExecutionOutput(executionId);
      },
      cancelExecution(executionId) {
        return dependencies.terminal.cancelExecution(executionId);
      }
    };
  }
}

export function createLocalGatewayExecutor(dependencies: LocalGatewayExecutorDependencies): GatewayExecutor {
  return new LocalGatewayExecutor(dependencies);
}

export type { LocalGatewayExecutorDependencies };
