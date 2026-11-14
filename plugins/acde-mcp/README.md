# 会话内的 acde MCP

本适配器复用当前 DSH 官方 `@deepseek-ai/dsh-mcp-client`，服务端仍为原始 `acde mcp`，不新增 Computer Use 工具实现。

每个实际 Agent 首次组装模型输入时，使用 `agent.session.header.cwd` 启动独立 MCP 连接，并将官方工具注册在该 Agent 的 scope。首轮发现完成后重新组装一次输入，确保第一轮请求即可看到工具。没有工作区的会话不启动 MCP，也不回退到宿主工程目录。并发初始化共享同一个启动 Promise；初始化失败清理临时目录，下一次可重试。

每个连接有独立的 `XDG_RUNTIME_DIR`：相对目录基于调用会话的工作区，`start` 所拥有的实例、默认控制目标、发现目录及应用 socket 与其他会话分离。不会自动选择宿主 DSH 的桌面进程。宿主后端的 `ACDE_APP_*` 身份、监听通道和 `NODE_OPTIONS` 不传给 MCP。应用自身数据仍遵循 acde 的正常持久化规则。

会话释放或适配器卸载时，先等官方 MCP 连接关闭及其所启动实例退出，再删除该连接的临时运行目录。生命周期、工具 schema、取消和图片投影由官方桥接负责。

DSH 后端还会在启动子进程、绑定公共 socket 前，在应用数据目录的 `harness-instance.sqlite` 持有独占事务。相同数据目录的第二个实例必须失败；操作系统在进程崩溃时自动释放锁。该文件只用于运行互斥，与协作图的业务数据库分离。

验证：

```sh
npm test
acde check
acde build
npm run test:mcp-isolation
```

集成验证直接使用部署产物的官方桥接和真实 MCP：首轮工具发现、两个工作区的 `start({dirs:["."]})`、同名应用后端隔离、停止一个后另一个继续响应。测试不启动模型任务，不修改已有工作区。
