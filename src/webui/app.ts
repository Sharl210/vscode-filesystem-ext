import { groupRootsBySource } from './rootGrouping';
import { pickInitialRootId } from './defaultRoot';
import { normalizeEntryName } from '../utils/nameValidation';

interface WorkspaceItem {
  id: string;
  name: string;
  uri: string;
  source: 'local' | 'workspace' | 'remote';
}

interface ConnectionInfo {
  kind: 'local' | 'remote';
  label: string;
  host: string;
  remoteName: string | null;
  authority: string | null;
}

interface InitialLocation {
  rootId: string;
  path: string;
  activeFilePath: string | null;
  expandedPaths: string[];
}

interface WorkspacesResponse {
  accessToken: string;
  initialLocation: InitialLocation | null;
  items: WorkspaceItem[];
  connection: ConnectionInfo;
}

interface DisguiseImageTemplate {
  id: string;
  label: string;
  dataUrl: string;
}

interface DisguiseImageSettings {
  selectedSource: 'template' | 'custom';
  selectedTemplateId: string;
  customImageDataUrl: string | null;
  templates: DisguiseImageTemplate[];
}

interface ExportJobSnapshot {
  jobId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  format: 'archive' | 'disguised-image';
  progress: number;
  stage: 'preparing' | 'collecting' | 'packaging' | 'disguising' | 'downloading' | 'completed' | 'failed';
  currentMessage: string;
  messages: string[];
  fileName: string | null;
  error: string | null;
}

interface ProgressDialogState {
  visible: boolean;
  title: string;
  stage: string;
  progress: number;
  currentMessage: string;
  messages: string[];
  canCancel: boolean;
  canClose: boolean;
  activeToken: number;
  cancelAction: null | (() => Promise<void>);
}

interface MarqueeSelectionState {
  active: boolean;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

type UploadTarget = {
  rootId: string;
  path: string;
};

type DroppedUploadFile = File & {
  __workspaceWebRelativePath?: string;
};

declare global {
  interface Window {
    __workspaceWebGatewayDocumentEventsCleanup?: () => void;
  }
}

interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size: number;
  mtime: number;
  mimeType: string;
  isText: boolean;
  downloadable: boolean;
}

interface DirectoryResponse {
  path: string;
  items: FileEntry[];
}

interface FileResponse {
  file: FileEntry;
  content?: string;
  editable: boolean;
}

interface ClipboardEntry {
  rootId: string;
  path: string;
  type: 'file' | 'directory';
}

interface ClipboardState {
  mode: 'copy' | 'cut';
  items: ClipboardEntry[];
}

type TabKind = 'text' | 'markdown' | 'csv' | 'image' | 'audio' | 'video' | 'pdf' | 'binary';

interface TabState {
  id: string;
  rootId: string;
  path: string;
  file: FileEntry;
  kind: TabKind;
  editable: boolean;
  dirty: boolean;
  content: string;
  objectUrl: string | null;
}

interface TreeNodeState {
  rootId: string;
  path: string;
}

const rootTree = requireElement<HTMLDivElement>('#rootTree');
const fileList = requireElement<HTMLDivElement>('#fileList');
const connectionInfo = requireElement<HTMLParagraphElement>('#connectionInfo');
const statusMessage = requireElement<HTMLDivElement>('#statusMessage');
const clipboardStatus = requireElement<HTMLDivElement>('#clipboardStatus');
const breadcrumbs = requireElement<HTMLDivElement>('#breadcrumbs');
const pathInput = requireElement<HTMLInputElement>('#pathInput');
const searchInput = requireElement<HTMLInputElement>('#searchInput');
const selectAllCheckbox = requireElement<HTMLInputElement>('#selectAllCheckbox');
const selectionSummary = requireElement<HTMLSpanElement>('#selectionSummary');
const tabStrip = requireElement<HTMLDivElement>('#tabStrip');
const viewerToolbar = requireElement<HTMLDivElement>('#viewerToolbar');
const viewerSurface = requireElement<HTMLDivElement>('#viewerSurface');
const contextMenu = requireElement<HTMLDivElement>('#contextMenu');
const uploadInput = requireElement<HTMLInputElement>('#uploadInput');
const uploadFolderInput = requireElement<HTMLInputElement>('#uploadFolderInput');
const settingsButton = requireElement<HTMLButtonElement>('#settingsButton');
const uploadChoiceDialog = requireElement<HTMLDivElement>('#uploadChoiceDialog');
const uploadFileChoiceButton = requireElement<HTMLButtonElement>('#uploadFileChoiceButton');
const uploadFolderChoiceButton = requireElement<HTMLButtonElement>('#uploadFolderChoiceButton');
const uploadChoiceCloseButton = requireElement<HTMLButtonElement>('#uploadChoiceCloseButton');
const disguiseSettingsDialog = requireElement<HTMLDivElement>('#disguiseSettingsDialog');
const disguiseTemplateList = requireElement<HTMLDivElement>('#disguiseTemplateList');
const disguiseCurrentPreview = requireElement<HTMLImageElement>('#disguiseCurrentPreview');
const disguiseCustomInput = requireElement<HTMLInputElement>('#disguiseCustomInput');
const disguiseSelectedFileName = requireElement<HTMLDivElement>('#disguiseSelectedFileName');
const disguiseArchiveFormatDescription = requireElement<HTMLDivElement>('#disguiseArchiveFormatDescription');
const disguiseSettingsSaveButton = requireElement<HTMLButtonElement>('#disguiseSettingsSaveButton');
const disguiseSettingsCloseButton = requireElement<HTMLButtonElement>('#disguiseSettingsCloseButton');
const exportProgressDialog = requireElement<HTMLDivElement>('#exportProgressDialog');
const exportProgressTitle = requireElement<HTMLDivElement>('#exportProgressTitle');
const exportProgressStage = requireElement<HTMLDivElement>('#exportProgressStage');
const exportProgressPercent = requireElement<HTMLDivElement>('#exportProgressPercent');
const exportProgressBar = requireElement<HTMLDivElement>('#exportProgressBar');
const exportProgressCurrentMessage = requireElement<HTMLDivElement>('#exportProgressCurrentMessage');
const exportProgressMessages = requireElement<HTMLDivElement>('#exportProgressMessages');
const exportProgressCloseButton = requireElement<HTMLButtonElement>('#exportProgressCloseButton');
const exportProgressCancelButton = requireElement<HTMLButtonElement>('#exportProgressCancelButton');
const expandedNodesStorageKey = 'workspaceWebGateway.expandedNodes.v1';

const state = {
  roots: [] as WorkspaceItem[],
  connection: null as ConnectionInfo | null,
  accessToken: '',
  currentRootId: '',
  currentPath: '',
  currentEntries: [] as FileEntry[],
  treeCache: new Map<string, FileEntry[]>(),
  expandedNodes: new Set<string>(),
  selectedPaths: new Set<string>(),
  lastSelectedIndex: -1,
  search: '',
  sortKey: 'name' as 'name' | 'type' | 'size' | 'mtime',
  sortDirection: 'asc' as 'asc' | 'desc',
  clipboard: null as ClipboardState | null,
  tabs: [] as TabState[],
  activeTabId: '' as string,
  dragItems: null as ClipboardEntry[] | null,
  contextTarget: null as { kind: 'entry' | 'tree'; path: string; type: 'file' | 'directory'; rootId: string } | null,
  disguiseSettings: null as DisguiseImageSettings | null,
  disguiseSelectedFileName: '未选择文件' as string,
  marqueeSelection: {
    active: false,
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0
  } as MarqueeSelectionState,
  progressDialog: {
    visible: false,
    title: '',
    stage: '',
    progress: 0,
    currentMessage: '',
    messages: [],
    canCancel: false,
    canClose: true,
    activeToken: 0,
    cancelAction: null
  } as ProgressDialogState
};

window.__workspaceWebGatewayDocumentEventsCleanup?.();
const documentEventsController = new AbortController();
window.__workspaceWebGatewayDocumentEventsCleanup = () => {
  documentEventsController.abort();
  delete window.__workspaceWebGatewayDocumentEventsCleanup;
};

bindEvents();
void bootstrap().catch(handleUiError);

async function bootstrap() {
  const response = await api<WorkspacesResponse>('/api/workspaces');

  state.accessToken = response.accessToken;
  state.roots = response.items;
  state.connection = response.connection;
  restoreExpandedNodes();

  const initialLocation = response.initialLocation;
  if (initialLocation) {
    applyExpandedPaths(initialLocation.rootId, initialLocation.expandedPaths);
  }

  state.currentRootId = initialLocation?.rootId ?? pickInitialRootId(response.items);
  state.currentPath = initialLocation?.path ?? '';

  renderConnection();
  await loadDirectory(state.currentRootId, state.currentPath, {
    renderTreeAfter: true,
    selectedPath: initialLocation?.activeFilePath ?? null
  });
}

function bindEvents() {
  requireElement<HTMLButtonElement>('#refreshButton').addEventListener('click', () => void refreshCurrentDirectory());
  requireElement<HTMLButtonElement>('#upButton').addEventListener('click', () => void navigateUp());
  requireElement<HTMLButtonElement>('#newFileButton').addEventListener('click', () => void createFile());
  requireElement<HTMLButtonElement>('#mkdirButton').addEventListener('click', () => void createDirectory());
  requireElement<HTMLButtonElement>('#renameButton').addEventListener('click', () => void renameSelection());
  requireElement<HTMLButtonElement>('#deleteButton').addEventListener('click', () => void deleteSelection());
  requireElement<HTMLButtonElement>('#copyButton').addEventListener('click', () => copySelection('copy'));
  requireElement<HTMLButtonElement>('#cutButton').addEventListener('click', () => copySelection('cut'));
  requireElement<HTMLButtonElement>('#pasteButton').addEventListener('click', () => void pasteClipboard());
  requireElement<HTMLButtonElement>('#downloadButton').addEventListener('click', () => downloadSelection());
  requireElement<HTMLButtonElement>('#exportArchiveButton').addEventListener('click', () => void exportSelection('archive'));
  requireElement<HTMLButtonElement>('#exportDisguisedImageButton').addEventListener('click', () => void exportSelection('disguised-image'));
  requireElement<HTMLButtonElement>('#uploadTriggerButton').addEventListener('click', () => openUploadChoiceDialog());
  settingsButton.addEventListener('click', () => void openDisguiseSettings());
  disguiseSettingsSaveButton.addEventListener('click', () => void saveDisguiseSettings());
  disguiseSettingsCloseButton.addEventListener('click', () => closeDisguiseSettings());
  disguiseCustomInput.addEventListener('change', () => void handleDisguiseCustomImageChange());
  uploadFileChoiceButton.addEventListener('click', () => {
    closeUploadChoiceDialog();
    uploadInput.click();
  });
  uploadFolderChoiceButton.addEventListener('click', () => {
    closeUploadChoiceDialog();
    uploadFolderInput.click();
  });
  uploadChoiceCloseButton.addEventListener('click', () => closeUploadChoiceDialog());
  exportProgressCloseButton.addEventListener('click', () => closeProgressDialog());
  exportProgressCancelButton.addEventListener('click', () => void cancelProgressDialog());

  uploadInput.addEventListener('change', () => {
    const files = Array.from(uploadInput.files ?? []);
    uploadInput.value = '';
    void uploadFiles(files, 'files');
  });
  uploadFolderInput.addEventListener('change', () => {
    const files = Array.from(uploadFolderInput.files ?? []);
    uploadFolderInput.value = '';
    void uploadFiles(files, 'folder');
  });

  pathInput.addEventListener('change', () => void goToPath(pathInput.value));
  searchInput.addEventListener('input', () => {
    state.search = searchInput.value.trim().toLowerCase();
    renderFileList();
  });
  selectAllCheckbox.addEventListener('change', () => toggleSelectAllVisible());
  fileList.addEventListener('mousedown', (event) => handleFileListMouseDown(event));

  document.querySelectorAll<HTMLButtonElement>('[data-sort-key]').forEach((button) => {
    button.addEventListener('click', () => {
      const nextKey = button.dataset.sortKey as typeof state.sortKey;
      if (state.sortKey === nextKey) {
        state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        state.sortKey = nextKey;
        state.sortDirection = 'asc';
      }
      renderFileList();
    });
  });

  document.addEventListener('click', (event) => {
    const target = event.target as Node;
    if (!contextMenu.hidden && !contextMenu.contains(target)) {
      hideContextMenu();
    }
  }, { signal: documentEventsController.signal });

  document.addEventListener('dragover', (event) => {
    if (hasExternalFiles(event.dataTransfer)) {
      event.preventDefault();
    }
  }, { signal: documentEventsController.signal });

  document.addEventListener('drop', (event) => {
    if (!hasExternalFiles(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    void handlePageDrop(event.dataTransfer);
  }, { signal: documentEventsController.signal });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      hideContextMenu();
      closeDisguiseSettings();
      closeUploadChoiceDialog();
      if (state.progressDialog.canClose) {
        closeProgressDialog();
      }
    }
  }, { signal: documentEventsController.signal });

  document.addEventListener('mousemove', (event) => {
    if (!state.marqueeSelection.active) {
      return;
    }

    state.marqueeSelection.currentX = event.clientX;
    state.marqueeSelection.currentY = event.clientY;
    updateMarqueeSelection();
  }, { signal: documentEventsController.signal });

  document.addEventListener('mouseup', () => {
    if (!state.marqueeSelection.active) {
      return;
    }

    finishMarqueeSelection();
  }, { signal: documentEventsController.signal });
}

async function refreshCurrentDirectory() {
  await loadDirectory(state.currentRootId, state.currentPath, { renderTreeAfter: true });
  setStatus('目录已刷新。');
}

async function loadDirectory(rootId: string, path: string, options: { renderTreeAfter?: boolean; selectedPath?: string | null } = {}) {
  if (!rootId) {
    renderAll();
    return;
  }

  const response = await api<DirectoryResponse>(`/api/tree?workspace=${encodeURIComponent(rootId)}&path=${encodeURIComponent(path)}`);
  state.currentRootId = rootId;
  state.currentPath = response.path;
  state.currentEntries = response.items;
  state.selectedPaths.clear();
  state.lastSelectedIndex = -1;
  state.treeCache.set(treeNodeKey(rootId, path), response.items.filter((item) => item.type === 'directory'));

  if (options.selectedPath && response.items.some((item) => item.path === options.selectedPath)) {
    state.selectedPaths.add(options.selectedPath);
  }

  await hydrateExpandedNodesForRoot(rootId);

  if (options.renderTreeAfter) {
    renderTree();
  }

  renderAll();
}

async function ensureTreeChildren(rootId: string, path: string) {
  const key = treeNodeKey(rootId, path);
  if (state.treeCache.has(key)) {
    return;
  }

  const response = await api<DirectoryResponse>(`/api/tree?workspace=${encodeURIComponent(rootId)}&path=${encodeURIComponent(path)}`);
  state.treeCache.set(key, response.items.filter((item) => item.type === 'directory'));
}

async function toggleTreeNode(node: TreeNodeState) {
  const key = treeNodeKey(node.rootId, node.path);
  if (state.expandedNodes.has(key)) {
    state.expandedNodes.delete(key);
    persistExpandedNodes();
    renderTree();
    return;
  }

  await ensureTreeChildren(node.rootId, node.path);
  state.expandedNodes.add(key);
  persistExpandedNodes();
  renderTree();
}

async function hydrateExpandedNodesForRoot(rootId: string) {
  const expandedPaths = getExpandedPathsForRoot(rootId)
    .sort((left, right) => left.split('/').filter(Boolean).length - right.split('/').filter(Boolean).length);

  for (const path of expandedPaths) {
    await ensureTreeChildren(rootId, path);
  }
}

function getExpandedPathsForRoot(rootId: string) {
  const prefix = `${rootId}::`;
  return [...state.expandedNodes]
    .filter((key) => key.startsWith(prefix))
    .map((key) => key.slice(prefix.length));
}

function applyExpandedPaths(rootId: string, paths: string[]) {
  for (const path of paths) {
    state.expandedNodes.add(treeNodeKey(rootId, normalizePath(path)));
  }
  persistExpandedNodes();
}

function restoreExpandedNodes() {
  state.expandedNodes.clear();

  try {
    const raw = window.localStorage.getItem(expandedNodesStorageKey);
    if (!raw) {
      return;
    }

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const root of state.roots) {
      const storedPaths = parsed[root.id];
      if (!Array.isArray(storedPaths)) {
        continue;
      }

      for (const path of storedPaths) {
        if (typeof path === 'string') {
          state.expandedNodes.add(treeNodeKey(root.id, normalizePath(path)));
        }
      }
    }
  } catch {
    window.localStorage.removeItem(expandedNodesStorageKey);
  }
}

function persistExpandedNodes() {
  const payload: Record<string, string[]> = {};

  for (const root of state.roots) {
    payload[root.id] = getExpandedPathsForRoot(root.id);
  }

  window.localStorage.setItem(expandedNodesStorageKey, JSON.stringify(payload));
}

function renderAll() {
  renderConnection();
  renderBreadcrumbs();
  renderTree();
  renderFileList();
  renderViewer();
  renderClipboardStatus();
}

function renderConnection() {
  connectionInfo.textContent = state.connection ? `当前连接：${state.connection.label}` : '当前连接：未知';
}

function renderTree() {
  rootTree.innerHTML = '';

  for (const group of groupRootsBySource(state.roots)) {
    const section = document.createElement('section');
    section.className = 'tree-section';

    const title = document.createElement('div');
    title.className = 'tree-section-title';
    title.textContent = group.label;
    section.appendChild(title);

    const list = document.createElement('ul');
    list.className = 'tree-list';

    for (const root of group.items) {
      list.appendChild(renderTreeNode(root.id, root.name, '', root.source === 'workspace' ? 'folder-root' : root.source));
    }

    section.appendChild(list);
    rootTree.appendChild(section);
  }
}

function renderTreeNode(rootId: string, label: string, path: string, iconType: 'local' | 'workspace' | 'remote' | 'folder-root' | 'directory') {
  const item = document.createElement('li');
  const row = document.createElement('div');
  row.className = `tree-row${isTreeActive(rootId, path) ? ' is-active' : ''}`;
  row.dataset.rootId = rootId;
  row.dataset.path = path;

  const toggle = document.createElement('button');
  toggle.className = 'tree-toggle';
  toggle.type = 'button';
  toggle.dataset.state = path === '' || iconType === 'directory' || iconType === 'folder-root' ? 'visible' : 'hidden';
  toggle.textContent = state.expandedNodes.has(treeNodeKey(rootId, path)) ? '▾' : '▸';
  toggle.addEventListener('click', (event) => {
    event.stopPropagation();
    void toggleTreeNode({ rootId, path });
  });

  const action = document.createElement('button');
  action.className = 'tree-action';
  action.type = 'button';
  action.addEventListener('click', () => void loadDirectory(rootId, path));
  action.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    showContextMenu(
      event.clientX,
      event.clientY,
      buildContextMenu({ kind: 'tree', rootId, path, type: 'directory' })
    );
  });
  action.addEventListener('dragover', (event) => handleDragOver(event, action));
  action.addEventListener('dragleave', () => action.classList.remove('is-drop-target'));
  action.addEventListener('drop', (event) => {
    event.preventDefault();
    action.classList.remove('is-drop-target');
    void moveDraggedItems(rootId, path);
  });

  const icon = document.createElement('span');
  icon.className = 'tree-icon';
  icon.textContent = treeIcon(iconType);

  const text = document.createElement('span');
  text.className = 'tree-text';
  text.textContent = label;

  const labelWrap = document.createElement('span');
  labelWrap.className = 'tree-label';
  labelWrap.append(icon, text);
  action.appendChild(labelWrap);

  row.append(toggle, action);
  item.appendChild(row);

  const cacheKey = treeNodeKey(rootId, path);
  if (state.expandedNodes.has(cacheKey)) {
    const children = state.treeCache.get(cacheKey) ?? [];
    if (children.length > 0) {
      const childList = document.createElement('ul');
      childList.className = 'tree-list';
      for (const child of children) {
        childList.appendChild(renderTreeNode(rootId, child.name, child.path, 'directory'));
      }
      item.appendChild(childList);
    }
  }

  return item;
}

function renderBreadcrumbs() {
  breadcrumbs.innerHTML = '';
  const root = getCurrentRoot();
  if (!root) {
    return;
  }

  const rootButton = document.createElement('button');
  rootButton.className = 'breadcrumb-btn';
  rootButton.type = 'button';
  rootButton.textContent = root.name;
  rootButton.addEventListener('click', () => void loadDirectory(root.id, ''));
  breadcrumbs.appendChild(rootButton);

  const segments = state.currentPath.split('/').filter(Boolean);
  let runningPath = '';
  for (const segment of segments) {
    const divider = document.createElement('span');
    divider.textContent = '›';
    breadcrumbs.appendChild(divider);

    runningPath = runningPath ? `${runningPath}/${segment}` : segment;
    const button = document.createElement('button');
    button.className = 'breadcrumb-btn';
    button.type = 'button';
    button.textContent = segment;
    button.addEventListener('click', () => void loadDirectory(root.id, runningPath));
    breadcrumbs.appendChild(button);
  }

  pathInput.value = state.currentPath;
}

function renderFileList() {
  fileList.innerHTML = '';

  const entries = getVisibleEntries();
  selectionSummary.textContent = `${state.selectedPaths.size} 项已选择 · ${entries.length} 项可见`;
  selectAllCheckbox.checked = entries.length > 0 && entries.every((entry) => state.selectedPaths.has(entry.path));
  selectAllCheckbox.indeterminate = state.selectedPaths.size > 0 && !selectAllCheckbox.checked;

  if (entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'preview-empty';
    empty.textContent = state.search ? '当前筛选条件下没有结果。' : '当前目录为空。';
    fileList.appendChild(empty);
    return;
  }

  entries.forEach((entry, index) => {
    const row = document.createElement('div');
    row.className = `file-row${state.selectedPaths.has(entry.path) ? ' is-selected' : ''}`;
    row.dataset.path = entry.path;
    row.draggable = true;
    row.addEventListener('click', (event) => handleRowClick(event, entry, index));
    row.addEventListener('dblclick', () => void openEntry(entry));
    row.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      if (!state.selectedPaths.has(entry.path)) {
        state.selectedPaths.clear();
        state.selectedPaths.add(entry.path);
        renderFileList();
      }
      showContextMenu(event.clientX, event.clientY, buildContextMenu({ kind: 'entry', rootId: state.currentRootId, path: entry.path, type: entry.type }));
    });
    row.addEventListener('dragstart', () => startDrag([entry]));
    row.addEventListener('dragover', (event) => {
      if (entry.type === 'directory') {
        handleDragOver(event, row);
      }
    });
    row.addEventListener('dragleave', () => row.classList.remove('is-drop-target'));
    row.addEventListener('drop', (event) => {
      event.preventDefault();
      row.classList.remove('is-drop-target');
      if (entry.type === 'directory') {
        void moveDraggedItems(state.currentRootId, entry.path);
      }
    });

    const main = document.createElement('div');
    main.className = 'file-row-main';

    const checkbox = document.createElement('input');
    checkbox.className = 'row-check';
    checkbox.type = 'checkbox';
    checkbox.checked = state.selectedPaths.has(entry.path);
    checkbox.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleSelection(entry.path);
    });

    const icon = document.createElement('span');
    icon.className = 'file-icon';
    icon.textContent = fileIcon(entry);

    const name = document.createElement('span');
    name.className = 'file-name';
    name.textContent = entry.name;

    main.append(checkbox, icon, name);
    row.append(
      main,
      textCell(fileTypeLabel(entry)),
      textCell(entry.type === 'directory' ? '—' : formatBytes(entry.size)),
      textCell(formatTimestamp(entry.mtime))
    );

    fileList.appendChild(row);
  });

  renderMarqueeSelectionBox();
}

function renderViewer() {
  tabStrip.innerHTML = '';
  viewerToolbar.innerHTML = '';
  viewerSurface.innerHTML = '';

  for (const tab of state.tabs) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `tab-item${tab.id === state.activeTabId ? ' is-active' : ''}`;
    item.addEventListener('click', () => {
      state.activeTabId = tab.id;
      renderViewer();
    });

    const title = document.createElement('span');
    title.className = 'tab-title';
    title.textContent = tab.file.name;

    const dirty = document.createElement('span');
    dirty.className = 'tab-dirty';
    dirty.textContent = tab.dirty ? '●' : '';

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'tab-close';
    close.textContent = '×';
    close.addEventListener('click', (event) => {
      event.stopPropagation();
      closeTab(tab.id);
    });

    item.append(title, dirty, close);
    tabStrip.appendChild(item);
  }

  const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId);
  if (!activeTab) {
    const empty = document.createElement('div');
    empty.className = 'viewer-empty';
    empty.textContent = '双击文件后会在这里打开新标签。';
    viewerSurface.appendChild(empty);
    return;
  }

  renderViewerToolbar(activeTab);
  renderTabContent(activeTab);
}

function renderViewerToolbar(tab: TabState) {
  const title = document.createElement('strong');
  title.textContent = tab.path;
  viewerToolbar.appendChild(title);

  const spacer = document.createElement('div');
  spacer.style.flex = '1';
  viewerToolbar.appendChild(spacer);

  if (tab.editable) {
    const saveButton = document.createElement('button');
    saveButton.type = 'button';
    saveButton.textContent = '保存';
    saveButton.addEventListener('click', () => void saveTab(tab.id));
    viewerToolbar.appendChild(saveButton);
  }

  const refreshButton = document.createElement('button');
  refreshButton.type = 'button';
  refreshButton.textContent = '重新载入';
  refreshButton.addEventListener('click', () => void reopenTab(tab));
  viewerToolbar.appendChild(refreshButton);

  const downloadButton = document.createElement('button');
  downloadButton.type = 'button';
  downloadButton.textContent = '下载';
  downloadButton.addEventListener('click', () => downloadTab(tab));
  viewerToolbar.appendChild(downloadButton);
}

function renderTabContent(tab: TabState) {
  switch (tab.kind) {
    case 'text':
      viewerSurface.appendChild(renderTextEditor(tab));
      break;
    case 'markdown':
      viewerSurface.appendChild(renderMarkdownEditor(tab));
      break;
    case 'csv':
      viewerSurface.appendChild(renderCsvEditor(tab));
      break;
    case 'image':
      viewerSurface.appendChild(renderImagePreview(tab));
      break;
    case 'audio':
      viewerSurface.appendChild(renderAudioPreview(tab));
      break;
    case 'video':
      viewerSurface.appendChild(renderVideoPreview(tab));
      break;
    case 'pdf':
      viewerSurface.appendChild(renderPdfPreview(tab));
      break;
    case 'binary':
      viewerSurface.appendChild(renderBinaryFallback(tab));
      break;
  }
}

function renderTextEditor(tab: TabState) {
  const wrapper = document.createElement('div');
  wrapper.className = 'editor-stack';
  const editor = document.createElement('textarea');
  editor.className = 'editor-textarea';
  editor.value = tab.content;
  editor.addEventListener('input', () => {
    tab.content = editor.value;
    tab.dirty = true;
    renderViewer();
  });
  wrapper.appendChild(editor);
  return wrapper;
}

function renderMarkdownEditor(tab: TabState) {
  const wrapper = document.createElement('div');
  wrapper.className = 'editor-stack';
  wrapper.appendChild(renderTextEditor(tab));

  const preview = document.createElement('div');
  preview.className = 'markdown-preview';
  preview.innerHTML = renderMarkdown(tab.content);
  wrapper.appendChild(preview);
  return wrapper;
}

function renderCsvEditor(tab: TabState) {
  const wrapper = document.createElement('div');
  wrapper.className = 'editor-stack';
  wrapper.appendChild(renderTextEditor(tab));
  wrapper.appendChild(renderCsvTable(tab.content));
  return wrapper;
}

function renderImagePreview(tab: TabState) {
  const image = document.createElement('img');
  image.className = 'image-preview';
  image.src = tab.objectUrl ?? '';
  image.alt = tab.file.name;
  return image;
}

function renderAudioPreview(tab: TabState) {
  const audio = document.createElement('audio');
  audio.className = 'media-preview';
  audio.controls = true;
  audio.src = tab.objectUrl ?? '';
  return audio;
}

function renderVideoPreview(tab: TabState) {
  const video = document.createElement('video');
  video.className = 'media-preview';
  video.controls = true;
  video.src = tab.objectUrl ?? '';
  return video;
}

function renderPdfPreview(tab: TabState) {
  const frame = document.createElement('iframe');
  frame.className = 'pdf-frame';
  frame.src = tab.objectUrl ?? '';
  return frame;
}

function renderBinaryFallback(tab: TabState) {
  const card = document.createElement('div');
  card.className = 'metadata-card';
  card.innerHTML = `
    <h3>${escapeHtml(tab.file.name)}</h3>
    <p>类型：${escapeHtml(fileTypeLabel(tab.file))}</p>
    <p>大小：${formatBytes(tab.file.size)}</p>
    <p>该文件类型当前不支持内嵌预览，可直接下载。</p>
  `;
  return card;
}

function renderCsvTable(content: string) {
  const rows = content.split(/\r?\n/).filter((line) => line.length > 0).map((line) => line.split(','));
  const wrapper = document.createElement('div');
  wrapper.className = 'csv-preview';
  if (rows.length === 0) {
    wrapper.textContent = 'CSV 内容为空。';
    return wrapper;
  }

  const table = document.createElement('table');
  table.className = 'csv-table';
  const header = document.createElement('tr');
  rows[0].forEach((cell) => {
    const th = document.createElement('th');
    th.textContent = cell;
    header.appendChild(th);
  });
  table.appendChild(header);

  rows.slice(1).forEach((cells) => {
    const tr = document.createElement('tr');
    cells.forEach((cell) => {
      const td = document.createElement('td');
      td.textContent = cell;
      tr.appendChild(td);
    });
    table.appendChild(tr);
  });

  wrapper.appendChild(table);
  return wrapper;
}

async function openEntry(entry: FileEntry) {
  if (entry.type === 'directory') {
    state.expandedNodes.add(treeNodeKey(state.currentRootId, entry.path));
    await loadDirectory(state.currentRootId, entry.path, { renderTreeAfter: true });
    return;
  }

  await openFileTab(state.currentRootId, entry);
}

async function openFileTab(rootId: string, entry: FileEntry) {
  const existing = state.tabs.find((tab) => tab.rootId === rootId && tab.path === entry.path);
  if (existing) {
    state.activeTabId = existing.id;
    renderViewer();
    return;
  }

  const textResponse = await api<FileResponse>(`/api/file?workspace=${encodeURIComponent(rootId)}&path=${encodeURIComponent(entry.path)}`);
  const kind = determineTabKind(entry);
  const tab: TabState = {
    id: `${rootId}:${entry.path}`,
    rootId,
    path: entry.path,
    file: textResponse.file,
    kind,
    editable: textResponse.editable,
    dirty: false,
    content: textResponse.content ?? '',
    objectUrl: null
  };

  if (!textResponse.editable || kind === 'image' || kind === 'audio' || kind === 'video' || kind === 'pdf' || kind === 'binary') {
    const { blobUrl } = await fetchPreviewBlob(rootId, entry.path, textResponse.file.mimeType);
    tab.objectUrl = blobUrl;
    if (!textResponse.editable && textResponse.file.isText && !textResponse.content) {
      tab.content = await fetchTextDownload(rootId, entry.path);
    }
  }

  state.tabs.push(tab);
  state.activeTabId = tab.id;
  renderViewer();
}

async function reopenTab(tab: TabState) {
  if (tab.objectUrl) {
    URL.revokeObjectURL(tab.objectUrl);
  }
  state.tabs = state.tabs.filter((item) => item.id !== tab.id);
  await openFileTab(tab.rootId, tab.file);
}

async function saveTab(tabId: string) {
  const tab = state.tabs.find((item) => item.id === tabId);
  if (!tab || !tab.editable) {
    return;
  }

  await api(`/api/file?workspace=${encodeURIComponent(tab.rootId)}&path=${encodeURIComponent(tab.path)}`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({ content: tab.content, encoding: 'utf-8' })
  });

  tab.dirty = false;
  setStatus(`已保存 ${tab.file.name}`);
  renderViewer();
  if (tab.rootId === state.currentRootId) {
    await refreshCurrentDirectory();
  }
}

function closeTab(tabId: string) {
  const tab = state.tabs.find((item) => item.id === tabId);
  if (!tab) {
    return;
  }

  if (tab.dirty && !window.confirm(`“${tab.file.name}” 尚未保存，确定关闭？`)) {
    return;
  }

  if (tab.objectUrl) {
    URL.revokeObjectURL(tab.objectUrl);
  }

  state.tabs = state.tabs.filter((item) => item.id !== tabId);
  if (state.activeTabId === tabId) {
    state.activeTabId = state.tabs[state.tabs.length - 1]?.id ?? '';
  }

  renderViewer();
}

async function createFile() {
  const rawName = window.prompt('新文件名称');
  if (!rawName) {
    return;
  }
  const name = normalizePromptName(rawName);
  if (!name) {
    return;
  }
  const targetPath = joinPath(state.currentPath, name);
  await api('/api/new-file', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ workspace: state.currentRootId, path: targetPath })
  });
  await refreshCurrentDirectory();
  const file: FileEntry = {
    name,
    path: targetPath,
    type: 'file',
    size: 0,
    mtime: Date.now(),
    mimeType: 'text/plain',
    isText: true,
    downloadable: true
  };
  await openFileTab(state.currentRootId, file);
}

async function createDirectory() {
  const rawName = window.prompt('新建文件夹名称');
  if (!rawName) {
    return;
  }
  const name = normalizePromptName(rawName);
  if (!name) {
    return;
  }

  await api('/api/mkdir', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ workspace: state.currentRootId, path: joinPath(state.currentPath, name) })
  });
  await refreshCurrentDirectory();
}

async function renameSelection() {
  const target = getPrimarySelection();
  if (!target) {
    setStatus('先选择一个文件或目录。');
    return;
  }

  const rawName = window.prompt('新的名称', getBaseName(target.path));
  if (!rawName) {
    return;
  }
  const name = normalizePromptName(rawName);
  if (!name || name === getBaseName(target.path)) {
    return;
  }

  const parent = getParentPath(target.path);
  const toPath = joinPath(parent, name);
  await api('/api/rename', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ workspace: target.rootId, fromPath: target.path, toPath })
  });
  await refreshCurrentDirectory();
}

async function deleteSelection() {
  const items = getSelectedEntries();
  if (items.length === 0) {
    setStatus('先选择要删除的项目。');
    return;
  }

  if (!window.confirm(`确定删除选中的 ${items.length} 项吗？`)) {
    return;
  }

  for (const item of items) {
    await api(`/api/file?workspace=${encodeURIComponent(item.rootId)}&path=${encodeURIComponent(item.path)}`, {
      method: 'DELETE'
    });
  }

  state.selectedPaths.clear();
  await refreshCurrentDirectory();
}

function copySelection(mode: 'copy' | 'cut') {
  const items = getSelectedEntries();
  if (items.length === 0) {
    setStatus('先选择文件或目录。');
    return;
  }

  state.clipboard = {
    mode,
    items
  };
  renderClipboardStatus();
}

async function pasteClipboard() {
  if (!state.clipboard || state.clipboard.items.length === 0) {
    setStatus('剪贴板为空。');
    return;
  }

  const existingNames = new Set(state.currentEntries.map((entry) => entry.name));
  for (const item of state.clipboard.items) {
    const originalName = getBaseName(item.path);
    const targetName = createUniqueName(originalName, existingNames);
    existingNames.add(targetName);
    const targetPath = joinPath(state.currentPath, targetName);

    if (state.clipboard.mode === 'copy') {
      await api('/api/copy', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          fromWorkspace: item.rootId,
          fromPath: item.path,
          toWorkspace: state.currentRootId,
          toPath: targetPath
        })
      });
      continue;
    }

    await api('/api/move', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fromWorkspace: item.rootId,
        fromPath: item.path,
        toWorkspace: state.currentRootId,
        toPath: targetPath
      })
    });
  }

  if (state.clipboard.mode === 'cut') {
    state.clipboard = null;
  }

  renderClipboardStatus();
  await refreshCurrentDirectory();
}

async function uploadFiles(files: File[], mode: 'files' | 'folder', targetOverride?: UploadTarget) {
  if (files.length === 0) {
    return;
  }

  const uploadTarget = await resolveUploadTarget(targetOverride);
  if (!uploadTarget) {
    return;
  }

  closeUploadChoiceDialog();
  const controller = new AbortController();
  const token = openProgressDialog({
    title: mode === 'folder' ? '上传文件夹' : '上传文件',
    stage: '准备上传',
    progress: 0,
    currentMessage: `已选中 ${files.length} 个项目`,
    messages: [`已选中 ${files.length} 个项目`],
    canCancel: true,
    canClose: false,
    cancelAction: async () => {
      controller.abort();
      closeProgressDialog();
      setStatus('上传已取消。');
    }
  });

  try {
    const normalizedFiles = files.map((file) => ({
      file,
      relativePath: getUploadRelativePath(file, mode)
    }));
    const directories = [...new Set(normalizedFiles.map(({ relativePath }) => getParentPath(relativePath)).filter(Boolean))].sort((left, right) => left.localeCompare(right, 'zh-CN'));
    const totalBytes = normalizedFiles.reduce((sum, { file }) => sum + file.size, 0);
    let completedBytes = 0;
    let completedFiles = 0;

    if (directories.length > 0) {
      for (const directory of directories) {
        throwIfOperationCancelled(token, controller.signal);
        updateProgressDialog(token, {
          stage: '创建目录',
          progress: calculateUploadProgress(completedBytes, totalBytes, 0),
          currentMessage: `正在创建目录 ${directory}`,
          appendMessage: `正在创建目录 ${directory}`
        });
        await api('/api/mkdir', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            workspace: uploadTarget.rootId,
            path: joinPath(uploadTarget.path, directory)
          })
        });
      }
    }

    for (const { file, relativePath } of normalizedFiles) {
      throwIfOperationCancelled(token, controller.signal);
      updateProgressDialog(token, {
        stage: '上传文件',
        progress: calculateUploadProgress(completedBytes, totalBytes, 0),
        currentMessage: `正在上传 ${relativePath}`,
        appendMessage: `正在上传 ${relativePath}`
      });

      const formData = new FormData();
      formData.set('workspace', uploadTarget.rootId);
      formData.set('path', joinPath(uploadTarget.path, getParentPath(relativePath)));
      formData.set('file', file, getBaseName(relativePath));
      await api('/api/upload', { method: 'POST', body: formData, signal: controller.signal });

      completedBytes += file.size;
      completedFiles += 1;
      updateProgressDialog(token, {
        stage: '上传文件',
        progress: calculateUploadProgress(completedBytes, totalBytes, 0),
        currentMessage: `已完成 ${completedFiles}/${normalizedFiles.length}：${relativePath}`,
        appendMessage: `已完成 ${completedFiles}/${normalizedFiles.length}：${relativePath}`
      });
    }

    await refreshCurrentDirectory();
    completeProgressDialog(token, `已上传 ${normalizedFiles.length} 个项目。`);
    setStatus(`已上传 ${normalizedFiles.length} 个项目。`);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return;
    }

    failProgressDialog(token, error instanceof Error ? error.message : '上传失败');
    throw error;
  }
}

async function handlePageDrop(dataTransfer: DataTransfer | null) {
  const files = await collectDroppedFiles(dataTransfer);
  if (files.length === 0) {
    return;
  }

  const isFolderDrop = files.some((file) => getDroppedRelativePath(file).includes('/'));
  await uploadFiles(files, isFolderDrop ? 'folder' : 'files');
}

function downloadSelection() {
  const selectedTargets = getSelectedEntries();
  const targets = selectedTargets.length > 0 ? selectedTargets : (() => {
    const active = getActiveTabSelection();
    return active ? [active] : [];
  })();

  if (targets.length === 0) {
    setStatus('先选择要下载的文件。');
    return;
  }

  const fileTargets = targets.filter((target) => target.type === 'file');
  if (fileTargets.length === 0) {
    setStatus('下载只支持文件，请改用打包下载处理目录。');
    return;
  }

  fileTargets.forEach((target) => {
    const url = withAccessToken(`/api/download?workspace=${encodeURIComponent(target.rootId)}&path=${encodeURIComponent(target.path)}`);
    window.open(url, '_blank', 'noopener,noreferrer');
  });
}

async function exportSelection(format: 'archive' | 'disguised-image') {
  const targets = getExportTargets();

  if (targets.length === 0) {
    setStatus('先选择要导出的文件或目录。');
    return;
  }

  const exportWorkspace = targets[0]?.rootId ?? state.currentRootId;
  const title = format === 'archive' ? '导出为压缩包' : '导出为伪装图片';
  const downloadController = new AbortController();
  let currentJobId = '';

  const token = openProgressDialog({
    title,
    stage: '创建导出任务',
    progress: 0,
    currentMessage: '正在创建导出任务',
    messages: ['正在创建导出任务'],
    canCancel: true,
    canClose: false,
    cancelAction: async () => {
      downloadController.abort();
      if (currentJobId) {
        await fetch(withAccessToken(`/api/export/jobs/${encodeURIComponent(currentJobId)}/cancel`), {
          method: 'POST',
          headers: { 'content-type': 'application/json' }
        }).catch(() => undefined);
      }
      closeProgressDialog();
      setStatus(`${title}已取消。`);
    }
  });

  try {
    const started = await api<ExportJobSnapshot>('/api/export/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workspace: exportWorkspace,
        format,
        paths: targets.map((target) => target.path)
      })
    });
    currentJobId = started.jobId;

    if (downloadController.signal.aborted || token !== state.progressDialog.activeToken) {
      await fetch(withAccessToken(`/api/export/jobs/${encodeURIComponent(currentJobId)}/cancel`), { method: 'POST' }).catch(() => undefined);
      return;
    }

    applyExportSnapshot(token, title, started);
    await pollExportJob(token, title, started.jobId, downloadController);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return;
    }

    failProgressDialog(token, error instanceof Error ? error.message : '导出失败');
    throw error;
  }
}

function downloadTab(tab: TabState) {
  const url = withAccessToken(`/api/download?workspace=${encodeURIComponent(tab.rootId)}&path=${encodeURIComponent(tab.path)}`);
  window.open(url, '_blank', 'noopener,noreferrer');
}

async function navigateUp() {
  if (!state.currentPath) {
    return;
  }
  await loadDirectory(state.currentRootId, getParentPath(state.currentPath), { renderTreeAfter: true });
}

async function goToPath(nextPath: string) {
  await loadDirectory(state.currentRootId, normalizePath(nextPath), { renderTreeAfter: true });
}

function handleRowClick(event: MouseEvent, entry: FileEntry, index: number) {
  if (event.shiftKey && state.lastSelectedIndex >= 0) {
    const entries = getVisibleEntries();
    const [start, end] = [state.lastSelectedIndex, index].sort((left, right) => left - right);
    state.selectedPaths.clear();
    entries.slice(start, end + 1).forEach((item) => {
      state.selectedPaths.add(item.path);
    });
  } else if (event.metaKey || event.ctrlKey) {
    toggleSelection(entry.path);
  } else {
    state.selectedPaths.clear();
    state.selectedPaths.add(entry.path);
  }

  state.lastSelectedIndex = index;
  renderFileList();
}

function handleFileListMouseDown(event: MouseEvent) {
  if (event.button !== 0) {
    return;
  }

  if (event.target !== fileList) {
    return;
  }

  state.selectedPaths.clear();
  state.lastSelectedIndex = -1;
  state.marqueeSelection = {
    active: true,
    startX: event.clientX,
    startY: event.clientY,
    currentX: event.clientX,
    currentY: event.clientY
  };
  renderFileList();
}

function toggleSelection(path: string) {
  if (state.selectedPaths.has(path)) {
    state.selectedPaths.delete(path);
  } else {
    state.selectedPaths.add(path);
  }
  renderFileList();
}

function toggleSelectAllVisible() {
  const entries = getVisibleEntries();
  if (selectAllCheckbox.checked) {
    entries.forEach((entry) => {
      state.selectedPaths.add(entry.path);
    });
  } else {
    entries.forEach((entry) => {
      state.selectedPaths.delete(entry.path);
    });
  }
  renderFileList();
}

function updateMarqueeSelection() {
  const selectionRect = getMarqueeClientRect();
  const rows = Array.from(fileList.querySelectorAll<HTMLElement>('.file-row'));
  state.selectedPaths.clear();

  rows.forEach((row) => {
    const path = row.dataset.path;
    if (!path) {
      return;
    }

    if (rectanglesIntersect(selectionRect, row.getBoundingClientRect())) {
      state.selectedPaths.add(path);
    }
  });

  renderFileList();
}

function finishMarqueeSelection() {
  state.marqueeSelection.active = false;
  renderFileList();
}

function renderMarqueeSelectionBox() {
  fileList.querySelector('.marquee-selection')?.remove();
  if (!state.marqueeSelection.active) {
    return;
  }

  const containerRect = fileList.getBoundingClientRect();
  const selectionRect = getMarqueeClientRect();
  const box = document.createElement('div');
  box.className = 'marquee-selection';
  box.style.left = `${selectionRect.left - containerRect.left + fileList.scrollLeft}px`;
  box.style.top = `${selectionRect.top - containerRect.top + fileList.scrollTop}px`;
  box.style.width = `${selectionRect.width}px`;
  box.style.height = `${selectionRect.height}px`;
  fileList.appendChild(box);
}

function getMarqueeClientRect() {
  const left = Math.min(state.marqueeSelection.startX, state.marqueeSelection.currentX);
  const top = Math.min(state.marqueeSelection.startY, state.marqueeSelection.currentY);
  const right = Math.max(state.marqueeSelection.startX, state.marqueeSelection.currentX);
  const bottom = Math.max(state.marqueeSelection.startY, state.marqueeSelection.currentY);
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top
  };
}

function rectanglesIntersect(
  left: { left: number; right: number; top: number; bottom: number },
  right: { left: number; right: number; top: number; bottom: number }
) {
  return left.left <= right.right && left.right >= right.left && left.top <= right.bottom && left.bottom >= right.top;
}

function getVisibleEntries() {
  return [...state.currentEntries]
    .filter((entry) => (state.search ? entry.name.toLowerCase().includes(state.search) : true))
    .sort(compareEntries);
}

function compareEntries(left: FileEntry, right: FileEntry) {
  const direction = state.sortDirection === 'asc' ? 1 : -1;

  if (left.type !== right.type) {
    return left.type === 'directory' ? -1 : 1;
  }

  switch (state.sortKey) {
    case 'size':
      return (left.size - right.size) * direction;
    case 'mtime':
      return (left.mtime - right.mtime) * direction;
    case 'type':
      return fileTypeLabel(left).localeCompare(fileTypeLabel(right)) * direction;
    default:
      return left.name.localeCompare(right.name, 'zh-CN') * direction;
  }
}

function getSelectedEntries(): ClipboardEntry[] {
  return getVisibleEntries()
    .filter((entry) => state.selectedPaths.has(entry.path))
    .map((entry) => ({ rootId: state.currentRootId, path: entry.path, type: entry.type }));
}

function getExportTargets() {
  const selected = getSelectedEntries();
  if (selected.length > 0) {
    return selected;
  }

  const active = getActiveTabSelection();
  return active ? [active] : [];
}

function openUploadChoiceDialog() {
  uploadChoiceDialog.hidden = false;
}

function closeUploadChoiceDialog() {
  uploadChoiceDialog.hidden = true;
}

function openProgressDialog(config: {
  title: string;
  stage: string;
  progress: number;
  currentMessage: string;
  messages: string[];
  canCancel: boolean;
  canClose: boolean;
  cancelAction: null | (() => Promise<void>);
}) {
  state.progressDialog.activeToken += 1;
  state.progressDialog.visible = true;
  state.progressDialog.title = config.title;
  state.progressDialog.stage = config.stage;
  state.progressDialog.progress = config.progress;
  state.progressDialog.currentMessage = config.currentMessage;
  state.progressDialog.messages = [...config.messages];
  state.progressDialog.canCancel = config.canCancel;
  state.progressDialog.canClose = config.canClose;
  state.progressDialog.cancelAction = config.cancelAction;
  renderProgressDialog();
  return state.progressDialog.activeToken;
}

function updateProgressDialog(token: number, update: { stage: string; progress: number; currentMessage: string; appendMessage?: string; canCancel?: boolean; canClose?: boolean }) {
  if (token !== state.progressDialog.activeToken || !state.progressDialog.visible) {
    return;
  }

  state.progressDialog.stage = update.stage;
  state.progressDialog.progress = Math.max(0, Math.min(100, Math.round(update.progress)));
  state.progressDialog.currentMessage = update.currentMessage;
  if (update.appendMessage && state.progressDialog.messages[state.progressDialog.messages.length - 1] !== update.appendMessage) {
    state.progressDialog.messages = [...state.progressDialog.messages, update.appendMessage].slice(-14);
  }
  if (typeof update.canCancel === 'boolean') {
    state.progressDialog.canCancel = update.canCancel;
  }
  if (typeof update.canClose === 'boolean') {
    state.progressDialog.canClose = update.canClose;
  }
  renderProgressDialog();
}

function completeProgressDialog(token: number, message: string) {
  updateProgressDialog(token, {
    stage: '已完成',
    progress: 100,
    currentMessage: message,
    appendMessage: message,
    canCancel: false,
    canClose: true
  });
}

function failProgressDialog(token: number, message: string) {
  updateProgressDialog(token, {
    stage: '失败',
    progress: 100,
    currentMessage: message,
    appendMessage: message,
    canCancel: false,
    canClose: true
  });
}

async function cancelProgressDialog() {
  if (!state.progressDialog.canCancel || !state.progressDialog.cancelAction) {
    return;
  }

  const action = state.progressDialog.cancelAction;
  state.progressDialog.canCancel = false;
  renderProgressDialog();
  await action();
}

function closeProgressDialog() {
  state.progressDialog.visible = false;
  state.progressDialog.stage = '';
  state.progressDialog.progress = 0;
  state.progressDialog.currentMessage = '';
  state.progressDialog.messages = [];
  state.progressDialog.canCancel = false;
  state.progressDialog.canClose = true;
  state.progressDialog.cancelAction = null;
  state.progressDialog.activeToken += 1;
  renderProgressDialog();
}

function renderProgressDialog() {
  exportProgressDialog.hidden = !state.progressDialog.visible;
  exportProgressTitle.textContent = state.progressDialog.title;
  exportProgressStage.textContent = state.progressDialog.stage;
  exportProgressPercent.textContent = `${state.progressDialog.progress}%`;
  exportProgressBar.style.width = `${state.progressDialog.progress}%`;
  exportProgressCurrentMessage.textContent = state.progressDialog.currentMessage;
  exportProgressMessages.innerHTML = '';
  for (const message of state.progressDialog.messages) {
    const item = document.createElement('div');
    item.textContent = message;
    exportProgressMessages.appendChild(item);
  }
  exportProgressCancelButton.disabled = !state.progressDialog.canCancel;
  exportProgressCloseButton.disabled = !state.progressDialog.canClose;
}

function applyExportSnapshot(token: number, title: string, snapshot: ExportJobSnapshot) {
  updateProgressDialog(token, {
    stage: formatExportStage(snapshot.stage),
    progress: snapshot.progress,
    currentMessage: snapshot.currentMessage,
    appendMessage: snapshot.messages[snapshot.messages.length - 1] ?? snapshot.currentMessage,
    canCancel: snapshot.status === 'queued' || snapshot.status === 'running',
    canClose: snapshot.status === 'completed' || snapshot.status === 'failed'
  });
  state.progressDialog.title = title;
  renderProgressDialog();
}

async function pollExportJob(token: number, title: string, jobId: string, downloadController: AbortController) {
  let snapshot = await api<ExportJobSnapshot>(`/api/export/jobs/${encodeURIComponent(jobId)}`);
  applyExportSnapshot(token, title, snapshot);

  while (token === state.progressDialog.activeToken && (snapshot.status === 'queued' || snapshot.status === 'running')) {
    await wait(200);
    if (token !== state.progressDialog.activeToken) {
      return;
    }
    snapshot = await api<ExportJobSnapshot>(`/api/export/jobs/${encodeURIComponent(jobId)}`);
    applyExportSnapshot(token, title, snapshot);
  }

  throwIfOperationCancelled(token, downloadController.signal);

  if (snapshot.status === 'completed') {
    updateProgressDialog(token, {
      stage: 'downloading',
      progress: 100,
      currentMessage: `正在下载 ${snapshot.fileName ?? '导出结果'}`,
      appendMessage: `正在下载 ${snapshot.fileName ?? '导出结果'}`,
      canCancel: true,
      canClose: false
    });
    state.progressDialog.cancelAction = async () => {
      downloadController.abort();
      await fetch(withAccessToken(`/api/export/jobs/${encodeURIComponent(jobId)}/cancel`), { method: 'POST' }).catch(() => undefined);
      closeProgressDialog();
      setStatus(`${title}已取消。`);
    };
    renderProgressDialog();
    await downloadCompletedExport(token, title, jobId, downloadController.signal);
    return;
  }

  if (snapshot.status === 'failed') {
    failProgressDialog(token, snapshot.error ?? snapshot.currentMessage);
    return;
  }
}

async function downloadCompletedExport(token: number, title: string, jobId: string, signal: AbortSignal) {
  const response = await fetch(withAccessToken(`/api/export/jobs/${encodeURIComponent(jobId)}/download`), { signal });
  if (!response.ok) {
    throw new Error(`下载失败：${response.status}`);
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = extractDownloadFileName(response.headers.get('content-disposition'));
  link.click();
  URL.revokeObjectURL(objectUrl);
  completeProgressDialog(token, `${title}已完成，下载已开始。`);
  setStatus(`${title}已完成。`);
}

function extractDownloadFileName(contentDisposition: string | null) {
  const utf8Match = contentDisposition?.match(/filename\*=UTF-8''([^;]+)/);
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1]);
  }

  const plainMatch = contentDisposition?.match(/filename="([^"]+)"/);
  return plainMatch?.[1] ?? 'download.bin';
}

function calculateUploadProgress(completedBytes: number, totalBytes: number, currentFileBytes: number) {
  const total = Math.max(totalBytes, 1);
  return ((completedBytes + currentFileBytes) / total) * 100;
}

function getUploadRelativePath(file: File, mode: 'files' | 'folder') {
  const droppedPath = getDroppedRelativePath(file);
  const relativePath = mode === 'folder' && droppedPath.length > 0
    ? droppedPath
    : mode === 'folder' && 'webkitRelativePath' in file && typeof file.webkitRelativePath === 'string'
      ? file.webkitRelativePath
    : file.name;
  return normalizePath(relativePath);
}

function throwIfOperationCancelled(token: number, signal: AbortSignal) {
  if (token !== state.progressDialog.activeToken || signal.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
}

function wait(timeoutMs: number) {
  return new Promise((resolve) => setTimeout(resolve, timeoutMs));
}

function withAccessToken(url: string) {
  if (!state.accessToken) {
    return url;
  }

  const [pathname, search = ''] = url.split('?');
  const params = new URLSearchParams(search);
  params.set('token', state.accessToken);
  return `${pathname}?${params.toString()}`;
}

async function resolveUploadTarget(targetOverride?: UploadTarget): Promise<UploadTarget | null> {
  if (targetOverride) {
    return targetOverride;
  }

  if (state.currentRootId) {
    return {
      rootId: state.currentRootId,
      path: state.currentPath
    };
  }

  const fallbackRoot = state.roots[0];
  if (!fallbackRoot) {
    setStatus('当前没有可用的文件存放位置。');
    return null;
  }

  const rawPath = window.prompt(`当前没有打开目录，请输入要存放到 ${fallbackRoot.name} 的路径`, '');
  if (rawPath === null) {
    return null;
  }

  return {
    rootId: fallbackRoot.id,
    path: normalizePath(rawPath)
  };
}

function hasExternalFiles(dataTransfer: DataTransfer | null) {
  if (!dataTransfer) {
    return false;
  }

  if (dataTransfer.files.length > 0) {
    return true;
  }

  return Array.from(dataTransfer.items ?? []).some((item) => item.kind === 'file');
}

async function collectDroppedFiles(dataTransfer: DataTransfer | null): Promise<DroppedUploadFile[]> {
  if (!dataTransfer) {
    return [];
  }

  const entryFiles = await collectDroppedEntryFiles(dataTransfer.items);
  if (entryFiles.length > 0) {
    return entryFiles;
  }

  return Array.from(dataTransfer.files ?? []) as DroppedUploadFile[];
}

async function collectDroppedEntryFiles(items: DataTransferItemList | DataTransferItem[] | undefined): Promise<DroppedUploadFile[]> {
  if (!items) {
    return [];
  }

  const files: DroppedUploadFile[] = [];
  for (const item of Array.from(items)) {
    const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null;
    if (!entry) {
      continue;
    }

    files.push(...await readDroppedEntry(entry));
  }

  return files;
}

async function readDroppedEntry(entry: {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (callback: (file: File) => void, error?: (reason?: unknown) => void) => void;
  createReader?: () => { readEntries(callback: (entries: Array<typeof entry>) => void, error?: (reason?: unknown) => void): void };
}, parentPath = ''): Promise<DroppedUploadFile[]> {
  const relativePath = parentPath ? `${parentPath}/${entry.name}` : entry.name;

  if (entry.isFile && typeof entry.file === 'function') {
    const file = await new Promise<File>((resolve, reject) => {
      entry.file?.(resolve, reject);
    });
    Object.defineProperty(file, '__workspaceWebRelativePath', {
      value: relativePath,
      configurable: true
    });
    return [file as DroppedUploadFile];
  }

  if (entry.isDirectory && typeof entry.createReader === 'function') {
    const reader = entry.createReader();
    const children: Array<typeof entry> = [];

    while (true) {
      const batch = await new Promise<Array<typeof entry>>((resolve, reject) => {
        reader.readEntries(resolve, reject);
      });

      if (batch.length === 0) {
        break;
      }

      children.push(...batch);
    }

    const nested = await Promise.all(children.map((child) => readDroppedEntry(child, relativePath)));
    return nested.flat();
  }

  return [];
}

function getDroppedRelativePath(file: File) {
  const droppedPath = (file as DroppedUploadFile).__workspaceWebRelativePath;
  if (typeof droppedPath === 'string' && droppedPath.length > 0) {
    return droppedPath;
  }

  return 'webkitRelativePath' in file && typeof file.webkitRelativePath === 'string'
    ? file.webkitRelativePath
    : '';
}

function formatExportStage(stage: ExportJobSnapshot['stage']) {
  switch (stage) {
    case 'preparing':
      return '准备阶段';
    case 'collecting':
      return '收集阶段';
    case 'packaging':
      return '打包阶段';
    case 'disguising':
      return '伪装阶段';
    case 'downloading':
      return '下载阶段';
    case 'completed':
      return '已完成';
    case 'failed':
      return '失败';
  }
}

function getPrimarySelection(): ClipboardEntry | null {
  return getSelectedEntries()[0] ?? null;
}

function getActiveTabSelection(): ClipboardEntry | null {
  const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId);
  if (!activeTab) {
    return null;
  }

  return {
    rootId: activeTab.rootId,
    path: activeTab.path,
    type: activeTab.file.type
  };
}

function renderClipboardStatus() {
  if (!state.clipboard) {
    clipboardStatus.textContent = '剪贴板为空';
    return;
  }

  clipboardStatus.textContent = `剪贴板：${state.clipboard.mode === 'copy' ? '复制' : '剪切'} ${state.clipboard.items.length} 项`;
}

function showContextMenu(x: number, y: number, items: Array<{ label: string; danger?: boolean; action: () => void }>) {
  contextMenu.innerHTML = '';

  for (const item of items) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = item.label;
    if (item.danger) {
      button.classList.add('is-danger');
    }
    button.addEventListener('click', () => {
      hideContextMenu();
      item.action();
    });
    contextMenu.appendChild(button);
  }

  contextMenu.style.left = `${x}px`;
  contextMenu.style.top = `${y}px`;
  contextMenu.hidden = false;
}

function hideContextMenu() {
  contextMenu.hidden = true;
}

function buildContextMenu(target: { kind: 'entry' | 'tree'; rootId: string; path: string; type: 'file' | 'directory' }) {
  return [
    { label: '打开', action: () => void openTarget(target) },
    { label: '复制', action: () => copyTarget(target, 'copy') },
    { label: '剪切', action: () => copyTarget(target, 'cut') },
    { label: '粘贴到这里', action: () => void pasteIntoTarget(target) },
    { label: '重命名', action: () => void renameSpecificTarget(target) },
    { label: '删除', danger: true, action: () => void deleteSpecificTarget(target) }
  ];
}

async function openTarget(target: { rootId: string; path: string; type: 'file' | 'directory' }) {
  if (target.type === 'directory') {
    await loadDirectory(target.rootId, target.path, { renderTreeAfter: true });
    return;
  }

  const entry = state.currentEntries.find((item) => item.path === target.path);
  if (entry) {
    await openFileTab(target.rootId, entry);
  }
}

function copyTarget(target: { rootId: string; path: string; type: 'file' | 'directory' }, mode: 'copy' | 'cut') {
  state.clipboard = { mode, items: [{ rootId: target.rootId, path: target.path, type: target.type }] };
  renderClipboardStatus();
}

async function pasteIntoTarget(target: { rootId: string; path: string; type: 'file' | 'directory' }) {
  const destination = target.type === 'directory' ? target.path : getParentPath(target.path);
  if (state.currentRootId !== target.rootId || state.currentPath !== destination) {
    await loadDirectory(target.rootId, destination, { renderTreeAfter: true });
  }
  await pasteClipboard();
}

async function renameSpecificTarget(target: { rootId: string; path: string; type: 'file' | 'directory' }) {
  const rawName = window.prompt('新的名称', getBaseName(target.path));
  if (!rawName) {
    return;
  }
  const name = normalizePromptName(rawName);
  if (!name || name === getBaseName(target.path)) {
    return;
  }
  await api('/api/rename', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ workspace: target.rootId, fromPath: target.path, toPath: joinPath(getParentPath(target.path), name) })
  });
  if (target.rootId === state.currentRootId) {
    await refreshCurrentDirectory();
  }
}

async function deleteSpecificTarget(target: { rootId: string; path: string; type: 'file' | 'directory' }) {
  await api(`/api/file?workspace=${encodeURIComponent(target.rootId)}&path=${encodeURIComponent(target.path)}`, { method: 'DELETE' });
  if (target.rootId === state.currentRootId) {
    await refreshCurrentDirectory();
  }
}

function handleDragOver(event: DragEvent, element: HTMLElement) {
  event.preventDefault();
  element.classList.add('is-drop-target');
}

function startDrag(entries: FileEntry[]) {
  const selected = getSelectedEntries();
  state.dragItems = selected.length > 0 ? selected : entries.map((entry) => ({ rootId: state.currentRootId, path: entry.path, type: entry.type }));
}

async function moveDraggedItems(targetRootId: string, targetPath: string) {
  if (!state.dragItems || state.dragItems.length === 0) {
    return;
  }

  const existingNames = new Set(targetRootId === state.currentRootId && targetPath === state.currentPath ? state.currentEntries.map((entry) => entry.name) : []);
  for (const item of state.dragItems) {
    const targetName = createUniqueName(getBaseName(item.path), existingNames);
    existingNames.add(targetName);
    await api('/api/move', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fromWorkspace: item.rootId,
        fromPath: item.path,
        toWorkspace: targetRootId,
        toPath: joinPath(targetPath, targetName)
      })
    });
  }

  state.dragItems = null;
  if (targetRootId === state.currentRootId) {
    await refreshCurrentDirectory();
  }
}

async function openDisguiseSettings() {
  state.disguiseSettings = await api<DisguiseImageSettings>('/api/settings/disguised-image');
  disguiseCustomInput.value = '';
  state.disguiseSelectedFileName = state.disguiseSettings.selectedSource === 'custom' && state.disguiseSettings.customImageDataUrl
    ? '已保存的自定义图片'
    : '未选择文件';
  renderDisguiseSettings();
  disguiseSettingsDialog.hidden = false;
}

function closeDisguiseSettings() {
  disguiseSettingsDialog.hidden = true;
}

function renderDisguiseSettings() {
  disguiseTemplateList.innerHTML = '';

  if (!state.disguiseSettings) {
    disguiseCurrentPreview.removeAttribute('src');
    return;
  }

  for (const template of state.disguiseSettings.templates) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `template-card${isActiveDisguiseTemplate(template.id) ? ' is-active' : ''}`;
    button.addEventListener('click', () => {
      if (!state.disguiseSettings) {
        return;
      }

      state.disguiseSettings.selectedSource = 'template';
      state.disguiseSettings.selectedTemplateId = template.id;
      renderDisguiseSettings();
    });

    const image = document.createElement('img');
    image.src = template.dataUrl;
    image.alt = template.label;

    const label = document.createElement('span');
    label.textContent = template.label;

    button.append(image, label);
    disguiseTemplateList.appendChild(button);
  }

  const previewUrl = getActiveDisguisePreview();
  if (previewUrl) {
    disguiseCurrentPreview.src = previewUrl;
  } else {
    disguiseCurrentPreview.removeAttribute('src');
  }
  disguiseSelectedFileName.textContent = state.disguiseSelectedFileName;
  disguiseArchiveFormatDescription.textContent = '伪装图片固定使用标准 ZIP 归档，优先兼容性与生成速度，采用最低压缩开销，不追求高压缩率。';
}

function isActiveDisguiseTemplate(templateId: string) {
  return !!state.disguiseSettings && state.disguiseSettings.selectedSource === 'template' && state.disguiseSettings.selectedTemplateId === templateId;
}

function getActiveDisguisePreview() {
  if (!state.disguiseSettings) {
    return '';
  }

  if (state.disguiseSettings.selectedSource === 'custom' && state.disguiseSettings.customImageDataUrl) {
    return state.disguiseSettings.customImageDataUrl;
  }

  return state.disguiseSettings.templates.find((template) => template.id === state.disguiseSettings?.selectedTemplateId)?.dataUrl ?? '';
}

async function saveDisguiseSettings() {
  if (!state.disguiseSettings) {
    return;
  }

  await api('/api/settings/disguised-image', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      selectedSource: state.disguiseSettings.selectedSource,
      selectedTemplateId: state.disguiseSettings.selectedTemplateId,
      customImageDataUrl: state.disguiseSettings.customImageDataUrl
    })
  });
  closeDisguiseSettings();
  setStatus('伪装图片设置已保存。');
}

async function handleDisguiseCustomImageChange() {
  const file = disguiseCustomInput.files?.[0];

  if (!file) {
    return;
  }

  if (!state.disguiseSettings) {
    state.disguiseSettings = await api<DisguiseImageSettings>('/api/settings/disguised-image');
  }

  const pngDataUrl = await convertImageFileToPngDataUrl(file);
  if (!state.disguiseSettings) {
    return;
  }

  state.disguiseSettings.selectedSource = 'custom';
  state.disguiseSettings.customImageDataUrl = pngDataUrl;
  state.disguiseSelectedFileName = file.name;
  renderDisguiseSettings();
  setStatus('图片已转换为 PNG，保存后会作为新的伪装图片。');
}

async function convertImageFileToPngDataUrl(file: File) {
  const inputDataUrl = await readFileAsDataUrl(file);
  if (inputDataUrl.startsWith('data:image/png;base64,')) {
    return inputDataUrl;
  }

  const image = await loadImage(inputDataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth || image.width || 1;
  canvas.height = image.naturalHeight || image.height || 1;
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('当前浏览器不支持图片转换。');
  }

  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(new Error('读取图片失败。'));
    reader.readAsDataURL(file);
  });
}

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片转换失败。'));
    image.src = source;
  });
}

async function fetchPreviewBlob(rootId: string, path: string, mimeType: string) {
  const response = await fetch(withAccessToken(`/api/download?workspace=${encodeURIComponent(rootId)}&path=${encodeURIComponent(path)}`));
  if (!response.ok) {
    throw new Error(`预览加载失败：${response.status}`);
  }
  const blob = await response.blob();
  return {
    blob,
    blobUrl: URL.createObjectURL(new Blob([blob], { type: mimeType || blob.type }))
  };
}

async function fetchTextDownload(rootId: string, path: string) {
  const response = await fetch(withAccessToken(`/api/download?workspace=${encodeURIComponent(rootId)}&path=${encodeURIComponent(path)}`));
  if (!response.ok) {
    throw new Error(`文本加载失败：${response.status}`);
  }
  return await response.text();
}

function determineTabKind(file: FileEntry): TabKind {
  if (file.mimeType.startsWith('image/')) {
    return 'image';
  }
  if (file.mimeType.startsWith('audio/')) {
    return 'audio';
  }
  if (file.mimeType.startsWith('video/')) {
    return 'video';
  }
  if (file.mimeType === 'application/pdf') {
    return 'pdf';
  }

  const extension = getExtension(file.name);
  if (extension === 'md') {
    return 'markdown';
  }
  if (extension === 'csv' || extension === 'tsv') {
    return 'csv';
  }
  if (file.isText) {
    return 'text';
  }
  return 'binary';
}

function treeNodeKey(rootId: string, path: string) {
  return `${rootId}::${path}`;
}

function isTreeActive(rootId: string, path: string) {
  return rootId === state.currentRootId && path === state.currentPath;
}

function getCurrentRoot() {
  return state.roots.find((root) => root.id === state.currentRootId) ?? null;
}

function getParentPath(path: string) {
  const segments = normalizePath(path).split('/').filter(Boolean);
  segments.pop();
  return segments.join('/');
}

function joinPath(parent: string, child: string) {
  return normalizePath(parent ? `${parent}/${child}` : child);
}

function normalizePath(value: string) {
  return value
    .split('/')
    .filter((segment) => segment && segment !== '.')
    .join('/');
}

function getBaseName(path: string) {
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function createUniqueName(name: string, existingNames: Set<string>) {
  if (!existingNames.has(name)) {
    return name;
  }

  const extension = getExtension(name);
  const base = extension ? name.slice(0, -(extension.length + 1)) : name;
  let index = 1;
  while (true) {
    const candidate = extension ? `${base} copy ${index}.${extension}` : `${base} copy ${index}`;
    if (!existingNames.has(candidate)) {
      return candidate;
    }
    index += 1;
  }
}

function getExtension(name: string) {
  const index = name.lastIndexOf('.');
  return index >= 0 ? name.slice(index + 1).toLowerCase() : '';
}

function fileIcon(entry: FileEntry) {
  if (entry.type === 'directory') {
    return '📁';
  }
  if (entry.mimeType.startsWith('image/')) {
    return '🖼️';
  }
  if (entry.mimeType.startsWith('audio/')) {
    return '🎵';
  }
  if (entry.mimeType.startsWith('video/')) {
    return '🎬';
  }
  if (entry.mimeType === 'application/pdf') {
    return '📕';
  }
  return '📄';
}

function treeIcon(kind: 'local' | 'workspace' | 'remote' | 'folder-root' | 'directory') {
  switch (kind) {
    case 'local':
      return '💻';
    case 'workspace':
    case 'folder-root':
      return '🗂️';
    case 'remote':
      return '🖧';
    case 'directory':
      return '📁';
  }
}

function fileTypeLabel(entry: FileEntry) {
  if (entry.type === 'directory') {
    return '文件夹';
  }
  if (entry.mimeType === 'application/pdf') {
    return 'PDF';
  }
  if (entry.mimeType.startsWith('image/')) {
    return '图片';
  }
  if (entry.mimeType.startsWith('audio/')) {
    return '音频';
  }
  if (entry.mimeType.startsWith('video/')) {
    return '视频';
  }
  const extension = getExtension(entry.name);
  return extension ? extension.toUpperCase() : '文件';
}

function formatTimestamp(value: number) {
  if (!value) {
    return '—';
  }
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function formatBytes(value: number) {
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  if (value < 1024 * 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function textCell(value: string) {
  const span = document.createElement('span');
  span.textContent = value;
  return span;
}

function renderMarkdown(content: string) {
  return escapeHtml(content)
    .replace(/^### (.*)$/gm, '<h3>$1</h3>')
    .replace(/^## (.*)$/gm, '<h2>$1</h2>')
    .replace(/^# (.*)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^/, '<p>')
    .replace(/$/, '</p>');
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function api<T = Record<string, unknown>>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const contentType = response.headers.get('content-type') ?? '';

  if (!contentType.includes('application/json')) {
    throw new Error(`Unexpected response type: ${contentType}`);
  }

  const payload = (await response.json()) as { ok: boolean; data?: T; error?: { message: string } };
  if (!response.ok || !payload.ok || !payload.data) {
    const message = payload.error?.message ?? `Request failed with status ${response.status}`;
    setStatus(message);
    throw new Error(message);
  }
  return payload.data;
}

function setStatus(message: string) {
  statusMessage.textContent = message;
}

function normalizePromptName(value: string): string | null {
  try {
    return normalizeEntryName(value);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : '名称无效');
    return null;
  }
}

function handleUiError(error: unknown) {
  const message = error instanceof Error ? error.message : '发生未知错误';
  setStatus(message);
}

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing required element: ${selector}`);
  }
  return element;
}
