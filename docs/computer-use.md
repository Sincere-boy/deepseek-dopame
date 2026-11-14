# 通过官方 acde MCP 操作 Dopame

保留 DSH `0.1.5-rc.2`，直接使用已有的 `@deepseek-ai/dsh-mcp-client` 启动官方 `acde mcp`。不新增 MCP 服务、不重复实现界面操作，也不修改上游源码。

## 接入与使用

运行 `npm run dev`，在桌面打开 DeepSeek Harness。`src/dopame.patch.yml` 注册 `acde` 服务，工具以 `mcp__acde__<原工具名>` 出现在模型工具列表中。例如：

- `webs`：查看应用页面。
- `snapshot`、`query`：观察窗口和元素，获取可操作的 ref。
- `open`、`act`、`input`、`pointer`：打开应用、点击、输入、拖动和滚动。
- `screenshot`：窗口或桌面截图。
- `wait_for`、`resize`：等待界面状态、调整窗口。

其余工具和参数也完整沿用官方目录，包括调试和开发会话管理能力。模型应先观察，再使用新 ref 操作，最后再次观察验证结果；不要凭空编造元素编号。坐标输入应区分截图的设备像素、页面 CSS 像素与桌面逻辑像素。

可以直接说：“使用 acde MCP 打开文本编辑器，新建空白文档并输入一段文字，然后截图确认。”

## 配置与生命周期

构建脚本把当前工程目录、acde 安装路径和会话发现所需的临时目录变量写入生成的 `dist/runtime/dopame-acde.json`。后端只把这些连接信息传给 DSH；DSH 的 MCP 客户端负责启动、工具发现、取消、错误与截图投影、重连和退出清理。

MCP 的工作目录是本工程；会话选择遵循 acde 官方规则。需要固定某个会话时，可以按官方方式使用 `sessions` 工具选择。MCP 不自行启动桌面，正常入口仍是 `npm run dev`。这项接入依赖同一台机器上的 acde 开发会话；不是独立安装版的原生 macOS Computer Use。

截图以标准 MCP image block 返回。支持图像的模型通过 DSH 现有附件链接收截图；不支持图像的模型收到 DSH 的诊断信息。系统能力授权和剪贴板操作遵循 acde 原有工具契约。

## 官方依据

- [Dopame MCP 文档](https://docs.dopame.ai/zh/guide/mcp/)
- [Dopame 调试工具](https://docs.dopame.ai/zh/guide/tools/)
- [当前 DSH 版本的 MCP 客户端](https://github.com/deepseek-ai/deepseek-harness/blob/c291e7961a515f6d7af9304e7fd1d257929aef26/packages/mcp/mcp-client/README.zh.md)
- [官方 Cua Driver MCP 接入实现](https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/experimental/computer-use-cua-driver-mcp/src/index.ts)：参考其 stdio 接入方式与生命周期分工，复用已有 MCP 客户端。

以上为原始文档链接，不保存官网文档的纯文本副本。

## 实际验收（2026-11-14）

- `npm test` 的 7 项现有通信与生命周期回归通过，`acde check`、`acde build` 通过。
- 已启动的 DSH `0.1.5-rc.2` 模型请求实际包含官方 `acde mcp` 的全部 32 项工具，命名空间为 `mcp__acde__`。
- 独立验证会话 `session-dde473cf-7673-4573-9136-4f7580d6b0d4` 完成 8 次成功 MCP 调用：`webs`、`snapshot`、`act`、`screenshot`。模型通过 Dock 打开文本编辑器，新建未保存文档，键入 `DOPAME_MCP_OK`，截图后再次读取界面状态。
- 截图结果实际生成持久化 image attachment；模型随后描述了截图中的文字、文档标题和状态栏，并回复 `DOPAME_MCP_VERIFIED`。对话以 `turn/end: completed` 结束。
- 页面错误日志与失败网络请求均为空。没有将仅工具发现成功当作截图或输入已通过。
- 保留空白测试文档供复核；未保存文件或改动已有文档。当前验收覆盖 Dopame 桌面的观察、语义点击、文本输入和截图，不代表逐项验证了全部开发调试工具或宿主 macOS 原生应用控制。
