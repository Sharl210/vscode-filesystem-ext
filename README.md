# VSCode 文件系统拓展

`vscode-filesystem-ext` 为 VSCode 导出三类能力：

- Web 文件管理界面
- MCP Streamable HTTP 服务
- 终端 Tab、同步执行、后台执行与结果读取

网页和 MCP 都不会直接碰操作系统文件系统，底层读写、删除、重命名、复制、上传、下载、导出和终端执行都通过 VS Code 代理完成。

## 特色能力

- **真实 VS Code 终端优先**：默认优先尝试真实 VS Code 终端，再按需回退 compatibility
- **Web + MCP 共用能力层**：网页和 MCP 走同一套文件、导出、终端执行能力
- **MCP 单实例**：固定端口、固定路径，多窗口共享同一个 MCP HTTP 实例
- **终端后台任务**：支持创建 Tab、同步执行、后台执行、状态查询、输出读取与取消
- **高信息密度工具说明**：MCP 工具说明会标明必填参数、可选参数、默认值与常见错误点

## 功能说明

- 资源管理器式三栏布局
- 支持本机根目录、工作区根目录、远程主机目录
- 支持文件浏览、重命名、删除、复制、剪切、粘贴
- 支持文本、Markdown、CSV、图片、PDF、音视频预览
- 支持文件上传、文件夹上传、整页拖拽上传
- 支持鼠标框选、多选、全选
- 支持打包下载
- 支持导出为伪装图片
- 支持导出与上传过程进度弹窗、取消和过程信息显示
- 支持终端 Tab 管理、同步执行、后台执行、取消、状态查询和输出读取
- 支持 MCP 单实例 HTTP 服务，多窗口共享固定端口

## 安装说明

1. 下载 Release 中的 `vscode-filesystem-ext-0.0.13.vsix`
2. 打开 VS Code
3. 进入扩展面板
4. 右上角菜单选择“从 VSIX 安装”
5. 选中该 `.vsix` 文件完成安装

也可以命令行安装：

```bash
code --install-extension vscode-filesystem-ext-0.0.13.vsix
```

## 使用说明

1. 安装扩展后打开任意本机目录、工作区或远程目录
2. 点击状态栏中的“工作区网关：启动”或直接使用拓展提供的网页入口
3. 浏览器会打开本地 Web 文件管理界面
4. 在网页中进行浏览、编辑、上传、下载和导出操作

### 上传

- 点击“上传”可选择上传文件或上传文件夹
- 也可以把文件或文件夹直接拖到网页任意位置
- 如果当前没有打开目录，会先询问存放路径

### 下载

- “下载”表示直接下载选中的文件
- 多选文件时会逐个触发浏览器下载
- “打包下载”表示将当前选中项打包后下载

### 伪装图片导出

- “导出为伪装图片”会把选中内容导出为图片文件
- 底层固定使用 ZIP 归档，优先兼容性和速度，不追求高压缩率
- 可在齿轮设置中选择内置封面或自定义图片

### 启动/对接 MCP HTTP 单实例服务

扩展提供命令：`工作区网页网关：启动/获取 MCP HTTP 入口`（`workspaceWebGateway.startMcpServer`）。

该命令会启动或复用一个 **MCP 单实例 HTTP 服务**，默认监听 `127.0.0.1:21080/mcp`，并把入口地址复制到剪贴板。多个 VS Code 窗口会共享同一个 MCP 端口实例。

MCP HTTP 入口默认**无需鉴权**，可直接对接使用。

注意：这不会改变 Web UI 网关原本的随机端口策略；Web UI 仍按原行为启动。

可在 VS Code `settings.json` 中配置：

```json
{
  "workspaceWebGateway.mcp.host": "127.0.0.1",
  "workspaceWebGateway.mcp.port": 21080,
  "workspaceWebGateway.mcp.path": "/mcp"
}
```

默认 MCP 入口示例：

```text
http://127.0.0.1:21080/mcp
```

#### Claude Desktop（`mcpServers` JSON 写法）

如果你希望按 Claude Desktop 常见的 MCP 配置风格描述同一组参数，可写成：

```json
{
  "mcpServers": {
    "workspace-web-gateway-mcp": {
      "url": "http://127.0.0.1:21080/mcp"
    }
  }
}
```

说明：上面这段是客户端侧 `mcpServers` 风格示例。对于本扩展，`workspaceWebGateway.startMcpServer` 命令会确保回环地址上的 MCP HTTP 单实例可用。

#### Codex CLI（`mcp_servers` TOML 写法）

在 Codex CLI 中，对应写法是 `~/.codex/config.toml` 的 `mcp_servers` 段：

```toml
[mcp_servers.workspace_web_gateway_mcp]
url = "http://127.0.0.1:21080/mcp"
```

这里推荐使用 `url` 对接回环地址上的 MCP Streamable HTTP 服务。

### MCP 能力说明

这个 MCP 不是“单独的文件型 MCP”或“单独的终端型 MCP”，而是 **VSCode 文件系统拓展** 提供的同一个 MCP 服务，同时具备：

- 文件读写、复制、移动、删除、导出能力
- 终端 Tab 管理、同步执行、后台执行、取消和输出读取能力
- 统一的 MCP 服务名：`vscode-filesystem-ext-mcp`

当前文件/导出工具包括：

- `list_workspaces`
- `list_directory`
- `read_text_file`
- `write_text_file`
- `read_binary_file`
- `write_binary_file`
- `find_files`
- `search_text`
- `read_json_file`
- `apply_text_edits`
- `get_diagnostics`
- `get_definition`
- `find_references`
- `get_document_symbols`
- `get_workspace_symbols`
- `get_hover`
- `get_code_actions`
- `prepare_rename`
- `get_rename_edits`
- `get_active_editor`
- `list_open_documents`
- `get_format_edits`
- `directory_tree`
- `apply_patch`
- `create_file`
- `create_directory`
- `delete_entry`
- `rename_entry`
- `copy_entry`
- `move_entry`
- `export_archive`
- `export_disguised_image`
- `start_export_job`
- `get_export_job`
- `download_export_job`
- `cancel_export_job`

终端工具包括：

- `new_terminal_tab`
- `close_terminal_tab`
- `list_terminal_tabs`
- `show_terminal_tab_content`
- `terminal_execute`
- `start_terminal_execution`
- `get_terminal_execution`
- `get_terminal_execution_output`
- `cancel_terminal_execution`

#### 终端参数约定

- `timeoutMs`：不填默认 `120000`（120 秒）
- `mode`：不填默认 `auto`，可显式指定 `compatibility`
- `shellIntegrationWaitMs`：不填默认 `30000`，可提高到 `60000`
- 在 `vscode-terminal` 模式下，`exitCode` 可能为 `null`，这是 VS Code shell integration 的可空边界，不应强行当作 `0`

#### 终端模式说明

- `auto`：默认值。优先尝试真实 VS Code 终端；若 shell integration 在等待窗口内不可用，才回退 compatibility
- `compatibility`：直接用系统终端执行，不等待 VS Code shell integration

#### 终端语义边界

- 这里用的是 **VS Code 自带终端**，不是我们自己实现的终端，也没有做任何 Linux / Windows / bash / PowerShell 风格转译
- 实际命令语义、参数兼容性、提示符样式、路径习惯，都取决于 **VS Code 当前终端配置和宿主环境**
- 因此不要假定这里一定是 bash，也不要假定一定支持类 Unix 命令；如果调用方要跨环境运行命令，应自己按当前终端环境选择命令写法

网页终端每 1 秒自动刷新一次，默认终端标题直接使用 `tabId`。

## 当前局限性

- **真实终端可见性是 best-effort，不是强保证**：默认优先走真实 VS Code 终端，但 VS Code shell integration 的可用性受 shell、profile、远程环境和启动时序影响。
- **auto 模式可能回退 compatibility**：如果在等待窗口内拿不到 shell integration，系统会自动回退到 compatibility，以保证任务可执行。
- **`exitCode` 在 `vscode-terminal` 模式下可能为 `null`**：这是 VS Code shell integration 的可空边界，不能安全地强行补成 `0`。
- **网页终端显示的是代理历史，不是 VS Code 终端缓冲区本身**：它会尽量同步命令与输出，但不承诺与 VS Code 终端面板逐字符完全一致。
- **如果你更重视健壮性，就用默认 `auto`**；如果你明确知道当前环境下真实终端不稳定，可以显式传 `mode=compatibility`。
- **长环境适配等待可调**：`shellIntegrationWaitMs` 默认 `30000`，可提高到 `60000`；它的作用是减少误判回退，不是保证所有环境都能稳定拿到 shell integration。
- **不要承诺固定 shell 风格**：这套 MCP 只能保证“命令被交给 VS Code 当前终端去执行”，不能保证 bash 风格、PowerShell 风格或某种固定参数兼容性。

#### 文件读取策略

MCP 的 `read_text_file` 不再优先把文件拦成“不可编辑二进制”。现在会**尽量对所有文件返回字符串内容**：

- 常见源码文件会优先按文本处理
- 即使文件不适合内联编辑，也会尽量返回文本化后的原始内容
- `editable` 只表示“是否适合直接编辑”，不再表示“是否能读取到内容”

`read_text_file` 现在还支持一组更适合模型分段处理的可选参数：

- `offset`：从第几行开始读取，1 起始
- `limit`：最多返回多少行
- `withLineNumbers`：是否给返回内容加行号前缀

当使用分段读取时，返回结果里会额外带 `slice`，包含本次读取的起止行、总行数和是否被截断，便于外部模型继续拉下一段。

### 面向 AI 编码的新工具约定

- `list_directory`：支持 `offset`、`limit`，返回 `totalItems` 和 `truncated`
- `read_binary_file`：支持 `offset`、`limit`，返回 `totalBytes` 和 `truncated`
- `find_files`：按 glob 递归找文件，支持 `offset`、`limit`，返回 `totalMatches` 和 `truncated`
- `search_text`：递归搜索文本，返回带 `lineNumber`、`columnNumber` 和上下文 `context` 的结果片段，并支持 `offset`、`limit`
- `read_json_file`：读取 JSON 后可按 `query` 提取局部值，并返回带行号的格式化文本 `content`
- `apply_text_edits`：按顺序应用结构化文本替换，适合替代简单 patch / sed 场景
- `get_diagnostics`：读取当前文件或工作区的语言诊断结果
- `get_definition`：查询指定位置的定义跳转结果
- `find_references`：查询指定位置的引用位置
- `get_document_symbols`：列出单个文件的文档符号
- `get_workspace_symbols`：按关键字列出工作区符号
- `get_hover`：读取当前位置的类型、文档和 hover 内容
- `get_code_actions`：读取当前位置可用的 quick fix / refactor 候选
- `prepare_rename`：先确认当前位置能否语义重命名，并返回占位符
- `get_rename_edits`：返回语义重命名将产生的编辑集合，但不直接落盘
- `get_active_editor`：读取当前激活编辑器的路径、语言、版本和选区
- `list_open_documents`：列出当前已打开文档及其基础状态
- `get_format_edits`：返回文档格式化建议的编辑集合，但不直接落盘
- `directory_tree`：返回目录树文本，适合替代 `tree` 做结构探查
- `apply_patch`：应用文件级补丁文本，适合替代简单 patch 工作流

这些工具的共同目标是减少 AI 在编码时对终端命令的依赖，并且默认通过分页、偏移和截断字段避免一次性把大量内容塞进模型上下文。

第二批语义工具依赖 VS Code 当前已激活的语言能力，所以在不同语言、不同扩展组合下，返回数量和精度会有所不同。对 TypeScript / JavaScript 一般最完整。

这也意味着：

- `get_definition`、`find_references`、`get_document_symbols`、`get_workspace_symbols` 可能返回空
- `get_hover` 可能只返回范围，内容为空
- `get_code_actions`、`get_format_edits` 在没有对应 provider / formatter 时也可能为空
- `prepare_rename` 能成功，并不代表后续 `get_rename_edits` 一定会返回完整结果

### 性能优先原则

- `find_files` 优先走 VS Code 原生文件搜索路径，而不是扩展侧手写全量目录递归
- `search_text` 会尽量先缩小候选文件集，再做文本匹配，避免为了分页先扫完整棵目录树
- `list_directory` 不再为了判断文本类型而在列目录时完整读取每个文件内容
- 这套非终端工具的目标不是“功能上能替代终端”，而是“常见场景下至少不比终端路径更笨重”

这意味着像 `.c` 这类源码文件，即使之前会被误判成 binary，现在也会优先把内容返回给外部模型处理。

## 开发与验证

```bash
npm install
npm run build
npm test
npm run typecheck
npm run test:extension
```

打包 VSIX：

```bash
npx @vscode/vsce package
```

## 许可证

本项目采用非商用许可，禁止将本项目及其衍生版本用于商业用途。

详见 `LICENSE`。
