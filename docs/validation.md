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

4 项回归测试覆盖：authority 隔离的认证 cookie、Host/Origin 一致性、未结束响应的实时流转发、升级握手及双向二进制数据、启动失败响应。上述命令已通过。

真实模型验证会话可用下列命令复核，参数传应用私有数据中的验证会话文件；脚本只输出工具名称和计数，不输出原始会话内容。

```sh
node scripts/verify-session.mjs /absolute/path/session.v3.jsonl.zstd
```

本轮记录有 173 个事件，16 种工具有成功结果，没有非预期工具错误。`edit` 首次调用因没有本次启动后的新鲜读取而被拒绝；模型读取文件后重试成功。这验证了原有文件观察约束仍生效。

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
| 应用日志 | 本轮结束时应用页面错误日志和失败网络请求为空 |
| 产物独立性 | 运行时 9 个符号链接均在产物内，没有指向原仓库或丢失目标的链接 |

## 继续验证的路径

Standard 当前注册 27 个工具。除上述 16 种外，`create_goal`、`get_goal`、`update_goal`、`exit_plan_mode`、`job_kill`、`read_image`、`ralph`、`subagent`、`subagent_fork`、`send_message`、`interrupt_agent` 尚未做完整真实调用验证。原始实现及其依赖已随运行时保留，不能将“已注册”当作这些路径的端到端通过证明。

`list_subagent_models`、`cordis_inspect_list`、`session_search` 不在该上游 Standard 预设的 27 项工具中；测试对话对此报告不可用。它们并非迁移遗漏，不能为了让检查变绿而改写默认工具集。

桌面模式会记录官方桌面自带 NPU 组件找不到额外 `dopame-harness` 程序的警告；这是桌面附加组件，DeepSeek 应用自身启动与工具调用不依赖它。
