# DeepSeek Harness for Dopame OS

在 Dopame OS 中运行完整 DeepSeek Harness，使用 acde 管理应用窗口、后端和生命周期。

上游源码固定于 `c291e7961a515f6d7af9304e7fd1d257929aef26`，位于 `vendor/harness`，保留 MIT 授权。适配代码与上游分离。

平台文档以 [Dopame 官方中文文档](https://docs.dopame.ai/zh/) 为准。开发时按需查阅原始页面，保留代码块、表格和链接的上下文，不维护纯文本副本。

开发环境需要 Node.js 24+、Corepack 与 acde。

```sh
npm install
npm run prepare:harness
acde check
acde dev
```

在官方 Dopame 桌面中启动：先按[官方安装说明](https://docs.dopame.ai/zh/start/install/)安装桌面包，再运行 `acde dev --desktop dopame`，从 Apps 列表打开 DeepSeek Harness。

`prepare:harness` 构建上游并打包运行时；日常 `acde build/dev` 只构建应用。上游变化后重新运行 `prepare:harness`，仅打包规则变化时可运行 `npm run prepare:runtime`。

应用使用独立数据目录。密钥通过设置页保存，源码和构建产物不携带密钥。本机 macOS acdert 与 Dopame 桌面运行、重启恢复及 Standard 默认 27 项工具调用均已验证通过；Linux 实机尚未测试。

验证范围、已通过功能与平台边界见 [运行验证](docs/validation.md)。`npm test` 运行通信适配层回归测试。
