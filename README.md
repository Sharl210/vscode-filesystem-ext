# vscode-filesystem-ext

`vscode-filesystem-ext` 是一个 VS Code 扩展。它通过 VS Code 自身的文件接口，把当前 VS Code 可访问的文件资源暴露成一个本地 Web 文件管理界面。

网页端不会直接碰操作系统文件系统，所有底层读写、删除、重命名、复制、上传、下载和导出都通过 VS Code 代理执行。

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

## 安装说明

1. 下载 Release 中的 `vscode-filesystem-ext-0.0.5.vsix`
2. 打开 VS Code
3. 进入扩展面板
4. 右上角菜单选择“从 VSIX 安装”
5. 选中该 `.vsix` 文件完成安装

也可以命令行安装：

```bash
code --install-extension vscode-filesystem-ext-0.0.5.vsix
```

## 使用说明

1. 安装扩展后打开任意本机目录、工作区或远程目录
2. 点击状态栏中的“工作区网关：启动”或直接使用扩展提供的网页入口
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

该命令会启动或复用一个 **MCP 单实例 HTTP 服务**，默认监听 `127.0.0.1:21080`，并把入口地址复制到剪贴板。多个 VS Code 窗口会共享同一个 MCP 端口实例。

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
