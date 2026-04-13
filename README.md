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

1. 下载 Release 中的 `vscode-filesystem-ext-0.0.12.vsix`
2. 打开 VS Code
3. 进入扩展面板
4. 右上角菜单选择“从 VSIX 安装”
5. 选中该 `.vsix` 文件完成安装

也可以命令行安装：

```bash
code --install-extension vscode-filesystem-ext-0.0.12.vsix
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

网页终端每 1 秒自动刷新一次，默认终端标题直接使用 `tabId`。

## 当前局限性

- **真实终端可见性是 best-effort，不是强保证**：默认优先走真实 VS Code 终端，但 VS Code shell integration 的可用性受 shell、profile、远程环境和启动时序影响。
- **auto 模式可能回退 compatibility**：如果在等待窗口内拿不到 shell integration，系统会自动回退到 compatibility，以保证任务可执行。
- **`exitCode` 在 `vscode-terminal` 模式下可能为 `null`**：这是 VS Code shell integration 的可空边界，不能安全地强行补成 `0`。
- **网页终端显示的是代理历史，不是 VS Code 终端缓冲区本身**：它会尽量同步命令与输出，但不承诺与 VS Code 终端面板逐字符完全一致。
- **如果你更重视健壮性，就用默认 `auto`**；如果你明确知道当前环境下真实终端不稳定，可以显式传 `mode=compatibility`。
- **长环境适配等待可调**：`shellIntegrationWaitMs` 默认 `30000`，可提高到 `60000`；它的作用是减少误判回退，不是保证所有环境都能稳定拿到 shell integration。

#### 文件读取策略

MCP 的 `read_text_file` 不再优先把文件拦成“不可编辑二进制”。现在会**尽量对所有文件返回字符串内容**：

- 常见源码文件会优先按文本处理
- 即使文件不适合内联编辑，也会尽量返回文本化后的原始内容
- `editable` 只表示“是否适合直接编辑”，不再表示“是否能读取到内容”

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
