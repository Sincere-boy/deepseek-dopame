# 迁移设计与验收

在 acdert 内运行原版界面和完整 Harness 后端，支持模型设置、会话持久化、流式对话、工作区与工具调用，不依赖另行启动的 Web 服务。

## 平台边界

- acde 后端支持 Node，listen 转换为私有 Unix socket，页面同源 API 路由到后端。
- 前端 ES 模块必须来自应用文件，动态插件必须一并打包。
- fetch、WebSocket、EventSource 支持，Web Worker、Service Worker 不支持。
- 后端不继承任意终端变量，应用数据由 ACDE_APP_DATA 管理。
- 保留 dsh profile 启动、插件架构与 agent loop。

## 实施与验收

1. 固定上游源码和平台文档。
2. 打包完整运行时，接入私有后端和页面入口。
3. 验证真实渲染、认证信任、动态插件及流式通信。
4. 实测模型、会话恢复、工作区、文件和 shell 工具，记录兼容性。

完成要求：acde check/build 通过；acde dev 运行并截图验证完整 UI；真实模型对话成功；重启后会话可恢复；工具逐项记录实测结果，未验证项不能宣称完成。
