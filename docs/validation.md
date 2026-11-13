# 运行验证

## 环境与边界

验证环境为 macOS Apple M2 Pro，acde / SDK / acdert 0.0.9，contract level 1，Node.js 25.8.1。应用配置要求 Node.js 24+。本轮覆盖 acdert 单应用模式和官方 Dopame 桌面模式；没有在 Linux 主机实测原生二进制。

上游源码固定于 `c291e7961a515f6d7af9304e7fd1d257929aef26`。Standard 预设及工具代码未修改，部署闭包保留其原始插件结构。

## 自动检查

```sh
npm test
acde check
acde build
```

7 项回归测试覆盖：authority 隔离的认证 cookie、Host/Origin 一致性、未结束响应的实时流转发、双向二进制消息及上游心跳应答、启动失败响应，以及子进程在正常断开、拒绝退出和启动中失去父进程时的回收。

真实模型验证会话可用下列命令复核，参数传应用私有数据中的验证会话文件；脚本只输出工具名称和计数，不输出原始会话内容。

```sh
node scripts/verify-session.mjs /absolute/path/session.v3.jsonl.zstd
```

验收脚本核对主会话与子会话，27 种 Standard 工具均有成功结果，并核对了 3 个子会话的实际输出。没有非预期工具错误。`edit` 首次调用因没有本次启动后的新鲜读取而被拒绝；模型读取文件后重试成功。这验证了原有文件观察约束仍生效。脚本同时对照真实请求头中的完整工具清单，不能只凭模型的总结宣称通过。

## 已实测能力

| 路径 | 证据 |
| --- | --- |
| 桌面启动 | Apps 列表含 DeepSeek Harness，点击后打开真实应用窗口 |
| 模型配置和实际对话 | 通过凭据 API 保存既有 DeepSeek key，模型回复 `DOPAME_HARNESS_OK` |
| 输入 | 空编辑器第一次输入成功，重启后的连续输入成功 |
| 工作区选择 | 应用内目录浏览器选择独立测试目录，建立会话 |
| 会话持久化 | 停止 acde 后重启，自动恢复工作区、会话、对话内容及模式 |
| 文件侧栏 | 列出 smoke.txt，打开文本预览；修改后显示待重新加载提示 |
| 文件操作 | `write`、`read`、`edit` 完成写入、读回和修改，磁盘内容核对通过 |
| 文件搜索 | `glob`、`grep` 找到 smoke.txt 及指定文本 |
| shell 和后台任务 | `bash`、`job_list`、`job_output` 返回指定输出，后台任务完成，exit code 0 |
| 网络 | `web_fetch` 抓取 example.com，`web_search` 返回实际搜索结果 |
| 待办 | `todo_write` 写入并完成清单，界面显示 4 completed |
| 人机问答 | `ask_user_question` 显示单选卡，提交后模型回复 `INTERACTION_OK` |
| 文件交付 | `present` 注册 smoke.txt，交付卡出现 |
| 工作流 | `workflow` 执行无子代理脚本，返回 `DOPAME_WORKFLOW_OK` |
| 代理状态查询 | `list_agents` 正常返回空列表 |
| 技能 | `skill` 加载测试工作区技能，模型回复 `DOPAME_SKILL_OK` |
| 目标状态 | `create_goal`、`get_goal`、`update_goal` 完成临时测试目标的创建、读取和完成 |
| 后台取消 | `job_kill` 终止指定 sleep 30 测试任务，状态 killed，signal SIGTERM |
| 图片 | `read_image` 成功读取 64×64 PNG，像素数据核对为红色 |
| 计划模式 | `/plan`、`exit_plan_mode` 显示计划审批卡，点击批准后退出并执行只读检查 |
| 独立子代理 | `subagent` 读取文件，返回实际 `SUBAGENT_READ_OK` 和正确文件内容 |
| Fork 子代理 | `subagent_fork` 启动等待，`interrupt_agent` 中断该回合；`send_message` 恢复后返回 `FORK_RESUME_OK` |
| 子代理跟进 | `send_message` 唤起已完成的子代理，返回 `SUBAGENT_FOLLOWUP_OK` |
| Ralph | `ralph` 执行 1 轮，子会话通过 structured_output 返回 complete 和 `RALPH_SMOKE_OK` |
| 产物独立性 | 运行时 9 个符号链接均在产物内，没有指向原仓库或丢失目标的链接 |
| 密钥 | 对 dist 和 .acde 全部文件扫描真实 API key，未发现匹配；密钥仅在应用私有数据中 |

## 工具范围

Standard 当前注册的 27 个工具均已完成真实调用验证。这里证明的是本轮代表性路径，不代表所有参数组合、错误分支或其他预设也已穷举验证。

`list_subagent_models`、`cordis_inspect_list`、`session_search` 不在该上游 Standard 预设的 27 项工具中；测试对话对此报告不可用。它们并非迁移遗漏，不能为了让检查变绿而改写默认工具集。

桌面模式会记录官方桌面自带 NPU 组件找不到额外 `dopame-harness` 程序的警告；这是桌面附加组件，DeepSeek 应用自身启动与工具调用不依赖它。

## 长连接修复

在 acdert 0.0.9 中观察到原始 WebSocket 字节隧道运行约 4 分钟后发生一次异常关闭并自动重连，疑似与心跳耦合有关。适配层改为两个独立 WebSocket 协议端点，各自处理控制帧和关闭语义，不关闭 Harness 的心跳检查。回归测试使用不会自动回 Pong 的页面侧客户端，确认适配层仍可向上游正常回应心跳并转发二进制消息。

打包后的 WebSocket 模块从应用自身的 Node 运行时闭包加载，使用其官方纯 JS 实现，避免可选本地加速模块被打包器替换为不完整占位对象。测试覆盖 2048 字节的掩码二进制消息。

最终构建真实回复 `WS_HOP_OK`，连续运行 333 秒期间没有页面错误或失败网络请求，随后再次对话收到 `FINAL_READY`。应用在可见 Dopame 桌面窗口运行，截图保存在本次任务的可视化输出目录。

## 开发重载修复

真实保存文件重载时发现：旧后端延迟退出，清理了新后端刚建立的公共 socket，导致页面启动失败。现将后端退出与 Harness 的有界优雅退出分离：后端及时退出，Harness 通过 IPC 失联信号自行关闭，最迟 2.5 秒回收；每代 Harness 使用独立、较短的私有 socket 目录。父进程异常消失也会触发回收。

保存 README 触发一次真实重载后，工作区及会话自动恢复，文件读取成功，shell 返回 `HOT_RELOAD_OK`。旧后端及其 Harness 子进程均已退出，只保留新一代父子进程。新页面无错误日志和失败请求；旧页面因重载主动关闭连接的记录不属于启动失败。
