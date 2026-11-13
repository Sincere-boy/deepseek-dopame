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
- acdert 已渲染完整原版界面，首次内部测试提示可交互关闭，工作区、会话列表、设置与模式选择正常出现。
- 已修复生产部署缺失的 workspace peer 依赖，采用扁平部署与依赖闭包保留单一 Cordis 实例。
- 已接入 WebSocket 升级转发；Host/Origin 保留 acdert 后端实际请求值，认证 cookie 按该 authority 签发。未关闭上游同源或认证校验。
- 连接恢复后 `acde console --level errors` 无错误，界面不再显示重连提示；仍需实际模型与工具验证。
- 平台适配保存在上游目录之外；用户数据使用应用的 `ACDE_APP_DATA/harness`，不向源码或产物写入密钥。真实验证通过凭据 API 将已有 `DEEPSEEK_API_KEY` 保存到应用私有数据，未导入旧会话或浏览器签名密钥。
- 原始 Harness 服务的可运行结论不作为迁移证明；本轮已在 acdert 内独立完成真实对话、持久化及 Standard 27 项工具验证。

## 已完成的端到端验证

- 真实模型经应用界面回复 `DOPAME_HARNESS_OK`。
- 应用内目录浏览器选择并创建独立测试工作区。
- 模型使用文件工具创建并读回 `smoke.txt`，内容为 `DOPAME_FILE_OK`；宿主文件检查确认写入。
- 模型运行 shell，实际返回 `DOPAME_SHELL_OK` 和工作区目录列表。
- 对话期间页面错误日志为空。

## 稳定性修复

- 上游部署独立于日常应用构建，避免依赖安装产生的文件事件反复触发开发重建。
- 以应用内目录浏览器替换宿主原生目录选择器，保持跨平台操作流程一致。
- 为空的 Lexical 输入框补齐初始 DOM 光标；只在不存在输入框内选区时处理，不替换编辑器或工具契约。
- HTTP/WebSocket 转发与 Harness 子进程生命周期分离，并为多 authority cookie、实时流、二进制升级流和启动失败补充自动测试。
- 子进程日志按完整 UTF-8 行解析，不输出启动 token；启动超时会终止子进程，子进程崩溃交由 acdert 的后端重启策略恢复。
- WebSocket 使用独立双跳连接处理心跳与关闭帧，避免原始字节转发在 acdert 0.0.9 下周期性断开。

详细验证结果与尚未完成的调用路径见 [运行验证](validation.md)。
