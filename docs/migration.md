# 迁移设计与验收

在 acdert 内运行原版界面和完整 Harness 后端，支持模型设置、会话持久化、流式对话、工作区与工具调用，不依赖另行启动的 Web 服务。

## 平台边界

- acde 后端支持 Node，listen 转换为私有 Unix socket，页面同源 API 路由到后端。
- 前端 ES 模块必须来自应用文件，动态插件必须一并打包。
- fetch、WebSocket、EventSource 支持，Web Worker、Service Worker 不支持。
- 后端不继承任意终端变量，应用数据由 ACDE_APP_DATA 管理。
- 保留 dsh profile 启动、插件架构与 agent loop。

## 实施与验收

1. 固定上游源码；按需查阅官网原始文档，不保存丢失格式的纯文本副本。
2. 打包完整运行时，接入私有后端和页面入口。
3. 验证真实渲染、认证信任、动态插件及流式通信。
4. 实测模型、会话恢复、工作区、文件和 shell 工具，记录兼容性。

完成要求：acde check/build 通过；acde dev 运行并截图验证完整 UI；真实模型对话成功；重启后会话可恢复；工具逐项记录实测结果，未验证项不能宣称完成。

## 官方依据

- [后端](https://docs.dopame.ai/zh/guide/backend/)：后端打包、私有 socket、环境与生命周期。
- [Web 兼容性](https://docs.dopame.ai/zh/reference/web/)：模块、网络、存储与浏览器 API。
- [框架适配](https://docs.dopame.ai/zh/guide/frameworks/)：构建输出与静态资源。
- [应用配置](https://docs.dopame.ai/zh/guide/config/)：窗口、能力与后端声明。
- [调试工具](https://docs.dopame.ai/zh/guide/tools/)：实际运行、页面检查与截图。

以上链接是查阅入口；实现细节需结合官网当前页面核对。

## 当前验证记录

- 已固定完整上游源码，安装工作区依赖，并完成原版完整构建（234 个前端产物）。
- `acde check` 已通过，初版 `acde build` 已通过。
- acdert 已创建应用窗口并执行启动页面，尚未验收完整界面。
- 直接生产部署 CLI 会遗漏 peer 依赖；正在按 workspace 依赖与 peer 闭包打包单一 Cordis 实例。
- 平台适配保存在上游目录之外；用户数据使用应用的 `ACDE_APP_DATA/harness`，不复制或提交密钥。
- 原始 Harness 服务的可运行结论不能证明迁移完成；后续仍需在 acdert 内验证真实对话、持久化及工具。
