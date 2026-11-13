# DSH 迁移到 Dopame：改了什么，为什么改动不大

这次迁移的实质是：**将现有 Web 前端和完整 Node 后端打包进 Dopame 应用，由 acdert 托管窗口和后端生命周期。** 主要运行、页面和打包适配代码约 300 行，不含上游源码、测试及验收脚本。

## 1. 保留了哪些代码

上游固定在 `c291e7961a515f6d7af9304e7fd1d257929aef26`，存放于 `vendor/harness`。与首次引入快照相比，该目录没有源码改动。

| 部分 | 保留内容 |
| --- | --- |
| 前端 | 原版 React 界面、Cordis 客户端插件、会话列表、设置、文件侧栏和工具卡片 |
| Agent 核心 | Agent loop、提示词组装、模型接入、上下文处理、插件装配 |
| 工具 | 文件、Shell、搜索、联网、目标、计划、技能、子代理和工作流等原始实现；Standard 默认 27 项工具集未改 |
| 状态与策略 | 会话持久化、凭据管理、配置、认证，以及原有权限和文件观察约束 |

没有重写这些业务能力，也不依赖另一个提前启动的 DSH Web 服务；应用携带自己的 DSH 运行时和依赖。

## 2. 新增或调整了什么

| 改动 | 用途与位置 |
| --- | --- |
| 应用声明 | `acde.config.jsonc` 声明名称、窗口大小、内存和后端入口 |
| 构建与部署 | 两个构建脚本打包前端和 Node 运行时，补齐 workspace/peer 依赖，保持单一 Cordis 实例；上游部署与日常构建分开 |
| 页面启动 | `src/index.html` 获取原版启动信息、加载原版资源；补齐空 Lexical 编辑器的初始光标 |
| 通信适配 | `src/backend/bridge.mjs` 转发 HTTP、流式响应和 WebSocket；保留 Host/Origin 校验及按 authority 绑定的认证 cookie；两端分别处理 WebSocket 心跳 |
| 进程与数据 | `server.mjs` 启动随包部署的 `dsh web`；设置独立数据目录；每代子进程使用独立 socket 目录，避免重载时互相清理 |
| 退出管理 | `child-lifetime.mjs` 通过 IPC 感知父进程退出，发送 SIGTERM，必要时在 2.5 秒后强制回收 |
| 目录选择 | 配置补丁把宿主原生目录对话框换成 DSH 自带的应用内目录浏览器，两个实现都来自原项目 |

## 3. 实际使用了哪些 OS 接口

**新增适配代码没有直接导入任何 `acde:*` 模块。** 系统能力主要通过 Node 和原有 DSH 本地 provider 使用。

| 层次 | 实际接口 |
| --- | --- |
| Dopame 托管 | 应用配置、`ACDE_APP_DATA`、`ACDE_APP_SOCKETS`，以及 acde 生成的 `acde-listen.js`；由运行时创建窗口、托管后端，将监听端口映射为私有 Unix socket |
| 进程控制 | Node `child_process.spawn`、父子进程 IPC、SIGTERM/SIGINT/SIGKILL |
| 文件与目录 | Node `fs`、`os.tmpdir()`；创建数据和临时目录、清理连接目录；实际工具读写继续使用 DSH 的本地文件 provider |
| 网络与通信 | Node `http`、`net` 和 `ws`；页面使用标准 `fetch`、WebSocket、EventSource；模型及联网工具继续沿用原有网络实现 |
| Shell | 原有本地进程 provider 启动 Bash、管理后台任务；没有改成调用 `acde:terminal` |

这里列的是代码使用的系统接口，未做内核系统调用跟踪，不能把它当作完整的 syscall 清单。输入光标修复属于标准 DOM 兼容处理，不是 OS 调用。

## 4. 为什么迁移看起来不太复杂

1. **原应用的形态与目标运行时匹配。** DSH 已经是 Web 界面加 Node 后端，Dopame 能承载这两部分，模型与工具业务无需换语言重写。
2. **没有拆掉原来的执行环境。** 文件、Shell、联网和子代理仍由 Node 及原有 provider 执行，不需要逐项重新实现。
3. **运行环境差异集中在少数边界。** 页面资源、认证、长连接、进程退出和数据目录可以在应用入口与适配层解决。
4. **复杂度已有承担者。** 跨平台基础能力主要由 Node、依赖库和 acdert 承担；改动少不代表这些复杂度不存在。

所以，准确的判断是：**在保留 Web/Node 执行环境的前提下，这次业务代码改动很少；主要工作是部署和稳定性适配。** 真正耗时的也是依赖打包、长连接和重载竞态，而非 Agent 算法。

如果进一步要求文件访问、命令执行接入 Dopame 原生能力，或去掉 Node 后端，需要重新设计 provider、权限和资源生命周期。这不是本轮已经完成的内容，也不是把 import 改名即可完成：

- `acde:fs` 使用授权根 ID 和相对路径，不能直接等同于 Node 的任意绝对路径访问。
- `acde:terminal` 提供终端会话及输入输出，不是通用 `child_process.spawn` 的逐项替代。
- `acde:network` 管理 Wi-Fi、网卡和连接状态，不是 HTTP 客户端；模型 HTTP 请求可以考虑标准 `fetch`。
- Node IPC、Worker Threads、原生扩展及现有持久化实现，需要分别评估替代方案；原生能力模块不是完整的 Node 兼容层。

这些能力的调用入口也不同：`acde:*` 面向运行时中的应用页面；桌面服务通过自己的上下文获取能力。当前 Node 后端不能简单地把 `node:*` 导入改为 `acde:*`。接口定义见[官方模块文档](https://docs.dopame.ai/zh/reference/modules/)。

## 5. 验证边界

本机 macOS 的 acdert 单应用及 Dopame 桌面模式已验证：Standard 默认 27 项工具均有成功调用记录，7 项回归测试通过，并验证了会话恢复、实际热重载及持续连接。Linux 实机尚未测试，也没有穷举其他预设与所有参数组合。

代码入口：[后端启动](../server.mjs)、[通信适配](../src/backend/bridge.mjs)、[配置补丁](../src/dopame.patch.yml)。详细证据见[运行验证](validation.md)。
