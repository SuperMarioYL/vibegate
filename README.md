[English](./README.en.md) · [Website](https://vibegate.lei6393.com) · [GitHub](https://github.com/SuperMarioYL/vibegate)

<picture>
  <source media="(max-width: 600px) and (prefers-color-scheme: dark)" srcset="./assets/presentation/hero-mobile-dark.svg">
  <source media="(max-width: 600px)" srcset="./assets/presentation/hero-mobile-light.svg">
  <source media="(prefers-color-scheme: dark)" srcset="./assets/presentation/hero-dark.svg">
  <img src="./assets/presentation/hero-light.svg" width="960" alt="Hero diagram">
</picture>

# VibeGate

**分享应用前，看清下一处要修的问题。**

VibeGate 将静态项目检查、许可证策略问题与启动运行汇总为中英双语红黄绿报告，并给出具体修复提示。

## 为什么需要它

项目在开发者 Shell 中能跑，也可能缺 README、依赖本地配置或无法重新启动。分项检查能指出究竟是哪类条件需要处理。

- **分项检查** — 就绪、许可证与启动保留各自结果。
- **解释下一步修改** — 问题带有双语修复提示。
- **保留结构化报告** — JSON 与终端视图暴露同一检查结果。

## 架构

<picture>
  <source media="(max-width: 600px) and (prefers-color-scheme: dark)" srcset="./assets/presentation/architecture-mobile-dark.svg">
  <source media="(max-width: 600px)" srcset="./assets/presentation/architecture-mobile-light.svg">
  <source media="(prefers-color-scheme: dark)" srcset="./assets/presentation/architecture-dark.svg">
  <img src="./assets/presentation/architecture-light.svg" width="960" alt="Architecture diagram">
</picture>

CLI 识别运行时标记并加载 .vibegate.yml；readiness 与 license 扫描器收集问题。启动路径把项目复制到临时目录，有依赖时安装，再用精简环境和超时运行 start 命令；报告取最严重的检查状态。

| 组件 | 职责 |
| --- | --- |
| `Project + config` | src/config.ts |
| `Static checks` | src/scan |
| `Temporary startup` | src/run/sandbox.ts |
| `Bilingual verdict` | src/report |

## 安装与快速上手

使用仓库清单声明的运行时版本。以下源码安装步骤可复现随仓示例。

```bash
git clone https://github.com/SuperMarioYL/vibegate.git
cd vibegate
npm ci
npm run build
```

需要 Node.js 20+；示例创建自身完整无依赖应用，两次启动检查均无需访问包仓库。

```bash
node examples/presentation-demo.mjs
```

## 实际运行示例

<picture>
  <source media="(max-width: 600px) and (prefers-color-scheme: dark)" srcset="./assets/presentation/process-mobile-dark.svg">
  <source media="(max-width: 600px)" srcset="./assets/presentation/process-mobile-light.svg">
  <source media="(prefers-color-scheme: dark)" srcset="./assets/presentation/process-dark.svg">
  <img src="./assets/presentation/process-light.svg" width="960" alt="Process diagram">
</picture>

The fixture moves from red to green after adding its README and correcting the startup exit status.

```text
{
  "stage": "before",
  "verdict": "red",
  "checks": [
    {
      "id": "readiness",
      "status": "fail",
      "codes": [
        "no-readme"
      ]
    },
    {
      "id": "license",
      "status": "pass",
      "codes": []
    },
    {
      "id": "clean-run",
      "status": "fail",
      "codes": [
        "crash"
      ]
    }
  ]
}
{
  "stage": "after",
  "verdict": "green",
  "checks": [
    {
      "id": "readiness",
      "status": "pass",
      "codes": []
    },
    {
      "id": "license",
      "status": "pass",
      "codes": []
    },
    {
      "id": "clean-run",
      "status": "pass",
      "codes": []
    }
  ]
}
```

完整命令与输出保存在 [docs/demo-results.json](./docs/demo-results.json). 输入和复现代码均随仓提供。

![已有终端录制](./assets/demo.gif)

保留已有录制供参考；上方文字示例给出当前可复现的操作。

## 用法

安装后在仓库根目录运行以下命令；处理自己的数据时替换相应路径。

```bash
node dist/cli.js scan examples/demo-app --no-json
node dist/cli.js run examples/demo-app --timeout 3000 --no-json
# Run all checks on a project you trust:
node dist/cli.js examples/demo-app --timeout 3000
```

## 配置

 .vibegate.yml 可配置 timeoutMs（默认 30000）、copyleftAllowlist、extraSecretPatterns、writeReport。--timeout 覆盖启动超时，--no-json 禁止写报告。scan 只做静态检查，run 只做启动，直接传路径则运行三项。报告通常写到项目 vibegate-report.json，项目只读时可能回退到用户目录。静态生产源码扫描排除测试与常见构建目录。

```yaml
timeoutMs: 30000
copyleftAllowlist: []
extraSecretPatterns: []
writeReport: true
```

## 集成与职责分工

<picture>
  <source media="(max-width: 600px) and (prefers-color-scheme: dark)" srcset="./assets/presentation/integrations-mobile-dark.svg">
  <source media="(max-width: 600px)" srcset="./assets/presentation/integrations-mobile-light.svg">
  <source media="(prefers-color-scheme: dark)" srcset="./assets/presentation/integrations-dark.svg">
  <img src="./assets/presentation/integrations-light.svg" width="960" alt="Integrations diagram">
</picture>

根据工作流选择输入与输出路径。本文本地示例验证其中明确说明的子流程。

| 路径 | 已实现职责 |
| --- | --- |
| Node / Bun manifests | Runtime and startup detection |
| Mini-program markers | Static checks; startup skipped |
| Installed package metadata | License policy flags |
| .vibegate.yml | Timeout and scanner settings |
| JSON + terminal | Bilingual findings and fix hints |

## 限制与后续方向

- 临时目录与精简环境不是操作系统安全沙箱。完整运行可能安装依赖并执行具有主机访问权限的项目脚本；先检查不熟悉的项目。
- 绿灯只覆盖已运行的检查，不代表部署就绪、法律许可或无漏洞。许可证标签是可配置的审阅信号。
- 红/黄问题本身目前不会让 CLI 非零退出；自动化应检查 report.verdict。长运行服务即使正常也可能超时，小程序启动会跳过。

更多运行时验收、服务健康检查与托管报告分享是后续方向；调查红黄绿结果时应保留 JSON 报告。

## 许可与贡献

许可见 [LICENSE](./LICENSE). 反馈问题时请提供最小输入、执行命令和实际输出。
