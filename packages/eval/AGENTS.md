# packages/eval — Node 侧 Skill 评测

适用于本目录。先读[根规则](../../AGENTS.md)、[架构](../../docs/architecture.md)、
[验收](../../docs/validation.md)及[评测研究证据](../../docs/research/skill-eval-probe.md)。

## 职责与入口

`src/bin.ts` 提供根 `pnpm eval` 调用的命令入口；`src/index.ts` 提供 Node 库入口。
评测、断言、报告与本地 workspace 由本包管理，不进入浏览器或 Kit Server 的业务数据库。

## 不变量

1. Provider 访问仅使用上游 SDK 公开导出或已经取证的公开 REST 合同，禁止 internal。
   新增旁路先核对 SDK 与研究证据，不能把历史 HTTP 状态当作永久 Provider 约定。
2. 触发判定只认 `tool_use` 且 `tool_name === "activate_skill"`、
   `tool_input.name` 匹配目标 Skill；不能用回答文本猜测触发。
3. 资产与结果落在调用方的本地评测 workspace，不提交生成报告、运行记录或凭据。
   社区 `evals/evals.json` 保持兼容，Kit 扩展配置放 `evals/kit.json`。
4. 上传审查等待异步且有界，超时与执行能力由当前 Schema / 配置决定。
   需要落盘或执行脚本的评测必须配置相应 environment 与 builtin toolkit，
   不能把无工具能力造成的失败归因于 Skill。
5. 清理按当前实现删除临时 Session、归档评测 Agent；Skill 依内容哈希复用，
   默认不硬删已上传版本。真实资源生命周期与结果需单独记录、核实。
6. 脚本断言和 judge 分开执行计分，judge 必须给证据引文；缺失 Token 记为 null，
   不编造运行指标，也不以 Mock 证明 Cloud 可用。

## 修改步骤

1. 新断言同步 `src/schema.ts`、`src/grade.ts` 与必要的代表性回归。
2. 修改 ingest、运行、清理或报告时验证实际合同及失败路径；长期上游结论归研究文档。
3. 根 `pnpm eval` 依赖已构建的 `dist/bin.js`，CLI 与库行为共用实现。

## 验收

```bash
pnpm --filter @openagentpack/kit-eval typecheck
pnpm --filter @openagentpack/kit-eval test
pnpm check:architecture
pnpm check:docs
```

`eval-node-only-consumers` 保护浏览器依赖边界。远端评测会创建真实资源，
按任务授权与真实 Cloud 规则单独执行，离线断言通过不代表远端链路已验证。
