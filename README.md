# DeepSeek Harness for Dopame OS

在 Dopame OS 中运行完整 DeepSeek Harness，使用 acde 管理应用窗口、后端和生命周期。

上游源码固定于 `c291e7961a515f6d7af9304e7fd1d257929aef26`，位于 `vendor/harness`，保留 MIT 授权。适配代码与上游分离。

平台文档以 [Dopame 官方中文文档](https://docs.dopame.ai/zh/) 为准。开发时按需查阅原始页面，保留代码块、表格和链接的上下文，不维护纯文本副本。

开发环境需要 Node.js 24+、Corepack、acde，以及按[官方安装说明](https://docs.dopame.ai/zh/start/install/)安装的 Dopame 桌面包。

```sh
npm install
npm run prepare:harness
acde check
npm run dev
```

`npm run dev` 在官方 Dopame 桌面中启动，从 Apps 列表打开 DeepSeek Harness。窗口移动和 Dock 布局应在此模式下验证；`acde dev` 的单应用模式会填满宿主窗口。

`prepare:harness` 构建上游并打包运行时；日常 `acde build/dev` 只构建应用。上游变化后重新运行 `prepare:harness`，仅打包规则变化时可运行 `npm run prepare:runtime`。

应用使用独立数据目录。密钥通过设置页保存，源码和构建产物不携带密钥。本机 macOS acdert 与 Dopame 桌面运行、重启恢复及 Standard 默认 27 项工具调用均已验证通过；Linux 实机尚未测试。

验证范围、已通过功能与平台边界见 [运行验证](docs/validation.md)。`npm test` 运行通信适配层回归测试。

多会话流程管理入口为 **DeepSeek Harness → 协作工作区**，提供群聊、节点状态图、返工、人工介入和事件记录。使用方法、调度边界与验证命令见 [协作工作区插件](plugins/graph-collaboration/README.md)。

acde 工具复用官方 MCP 桥接，每个会话按所选工作区独立连接。`start` 的相对目录以该会话工作区为基准；会话启动的开发实例、默认控制目标和本地服务入口相互隔离。关闭会话会回收其 MCP 连接及所启动实例。DSH 同一数据目录只允许一个后端持有运行锁，重复启动会明确报错，不能覆盖原服务入口。

`acde build && npm run test:mcp-isolation` 使用两个临时工作区和真实 MCP 工具，验证首轮工具发现、相对目录、同名应用后端隔离和停止隔离，不调用模型。

在桌面中打开已有对话后，`npm run test:layout` 验证真实标题栏拖动、缩放、滚动和输入区边界。详见 [桌面窗口布局修复](docs/window-layout.md)。
