# AGENTS.md — worldModel 架构约束与工程约定

> 本文件是本项目的**权威指令文件**,等同于项目级 `CLAUDE.md`。任何在本目录工作的人或 agent
> 都应先读本文件并遵循其中约定。需要"记住"或"持久化项目规则"时,写入或更新本文件,**不要**新建项目级 `CLAUDE.md`。

## 1. 产品定位

`worldModel` 是一个**私有的个人世界模型工具**:记录信念(Belief)、为信念维护一组假设(Hypothesis),
持续采集观察(Observation),把已确认观察升级为证据(Evidence),用似然模型 + 贝叶斯规则更新假设概率,
并把每次概率变化记录为可审计、可回滚的更新事件(BayesianUpdateEvent)。

它**不是**公开预测市场,不提供访客交互,不发布投资建议。仅面向站点管理员本人。
详细需求与设计见 `docs/ai/world-model-requirements.md`、`docs/ai/world-model-technical-design.md`、
`docs/ai/world-model-rollout.md`。

## 2. 分层架构与依赖方向(核心约束)

代码分为四层,依赖只能**自上而下**,严禁反向或跨层回依赖:

```
app / components   (Next 路由、Server Actions、React UI)
        │  只能向下依赖
        ▼
server             (业务服务、Prisma 适配、来源采集、模型、训练、自动化)
        │
        ▼
lib                (面向 UI 的纯函数:格式化、视图模型、校验;无副作用、无 IO)
        │
        ▼
domain             (纯领域逻辑:贝叶斯更新、似然合成、去重、更新预览/回滚)
```

逐层职责与允许的依赖:

- **`src/domain`** — 纯 TypeScript 领域逻辑,**必须保持框架无关、无 IO、无副作用**。
  - 只能 import `src/domain` 内部模块。
  - **禁止** import `@/lib`、`@/server`、`@/app`、`@/components`、`@prisma/client`、`next`、`react`。
  - 这是系统的可测试核心,所有 Bayes/似然/去重算法都在这里。

- **`src/lib`** — 面向 UI 的纯函数层(视图模型、文案、排序、校验、图谱布局)。
  - 可以 import `@/domain`。
  - 与 `server` 共享的**数据类型**可以用 `import type` 从 `@/server/services/types` 引入(仅类型,编译期擦除)。
  - **禁止**从 `server` import 任何**运行时值**(函数/常量/类实例);**禁止** import `@/app`、`@/components`。
  - **禁止**直接触库(`@prisma/client`、`@/server/prisma`)。

- **`src/server`** — 服务端运行时:业务服务、持久化、采集、模型、训练、自动化。
  - 可以 import `@/domain`、`@/lib`、`server` 内部模块。
  - **禁止** import `@/app`、`@/components`。
  - 数据库访问见第 4 节(只能经 `WorldModelStore`)。

- **`src/app` / `src/components`** — Next 路由、Server Actions、React 组件。
  - 服务端代码(`page.tsx`、`route.ts`、`actions.ts`、`data.ts`)通过 `@/server/services` 的
    `getWorldModelServices()` 调用业务层,**不要**在 UI 层直接 new Prisma 或写业务规则。
  - 客户端组件通过 import `@/app/.../actions` 里的 Server Action 触发变更(Next 标准模式)。
  - **禁止**在 `app`/`components` 直接 import `@prisma/client` 或 `@/server/prisma`。

## 3. 服务层模块划分(禁止"上帝文件")

业务服务层(`src/server/services`)按**领域聚合**拆分,对应技术设计 §7,**不允许**把所有服务塞进一个文件:

| 模块 | 职责 |
| --- | --- |
| `belief-service.ts` | 信念/假设的增改、概率结构校验、假设推荐 |
| `observation-service.ts` | 观察写入、去重、未知/重复/拒绝/确认、结算 |
| `evidence-service.ts` | 观察确认为证据、证据-假设关联、编辑/重应用/拒绝/软删 |
| `likelihood-service.ts` | estimator 调用、likelihood run 持久化、ensemble 结果 |
| `update-service.ts` | 应用贝叶斯更新、更新事件、回滚、rebase |
| `source-service.ts` | 来源配置、preset、采集 adapter、observation run |
| `automation-service.ts` | 证据自动闭环、心跳、worker 配置 |
| `model-service.ts` | 模型产物管理与导入 |

- 跨服务复用的纯/半纯 helper 放在 `src/server/services/internal/`,由组合根与各服务模块 import。
  当前已下沉:`schemas.ts`(输入校验)、`shared.ts`(常量+基础 helper)、`recommendations.ts`(推荐引擎)、
  `evidence-queries.ts`(证据闭环纯查询)、`model-artifact.ts`(产物导入守卫)。
- `world-model-services.ts` 是**组合根**(composition root):`createWorldModelServices(store, options)`
  装配上表 8 组服务并返回 `WorldModelServices`。
- **当前结构**:上表的 per-service 模块已落地。`world-model-services.ts` 只负责装配 context、workflow
  与 8 组 service factory;新增业务必须放进对应聚合,不要让组合根重新膨胀。
- 经验阈值:`internal/` helper 模块尽量 **< 400 行**;per-service 模块拆分后尽量 **< 600 行**。超出说明该聚合需要再拆。
- 服务方法必须做输入校验(Zod),不允许 UI/API 直接写入非法概率、状态或 JSON。

## 4. 数据访问约束

- 业务服务只依赖 `WorldModelStore` 接口(`src/server/services/types.ts`),不直接依赖 Prisma。
- 数据库实现只允许出现在:`src/server/prisma.ts`、`src/server/services/prisma-store.ts`、
  `src/server/services/index.ts`(组合根)以及 `scripts/`。其他任何 `src/` 文件**禁止** import
  `@prisma/client` 或 `@/server/prisma`。
- 内存实现 `in-memory-store.ts` 用于测试与本地闭环,必须与 Prisma 实现保持同一接口语义。
- 世界模型数据存独立 Postgres,**禁止**写入 `myWeb` 的 schema。

## 5. 安全与隐私

- 采集平台的 cookie / API key / token **不入库、不进 Git**;来源配置只保存 `credentialRef` 引用名,真实值从环境变量或本地密钥文件读取。
- 禁止提交 `.env`、`.env.local`、`*.key`、`*.token`、`*.pem`、`model-artifacts/`(已在 `.gitignore`)。
- 训练数据**禁止使用 demo/合成数据**;只用公开真实数据集或本地真实确认证据,外部样本必须带 provenance。外部下载失败要显式报错,不得静默伪造样本。
- 投资类信念仅用于个人记录与概率更新,不提供交易执行或公开荐股。

## 6. 访问控制

- `proxy` 模式:`worldModel` 只接受携带内部 HMAC 签名的代理请求;无效/缺失/过期签名返回 401。
- `standalone` 模式:无 `myWeb` 时可直接访问 `/admin/world-model`。
- 切换由 `WORLDMODEL_ACCESS_MODE` 控制(见 `src/server/access-mode.ts`、`src/middleware.ts`)。

## 7. 验证与提交

每完成一个阶段,先跑相关验证再用 Git 本地提交(不自动 push):

```bash
npm run lint        # eslint(含架构边界规则,见第 8 节)
npm run typecheck   # tsc --noEmit
npm run test        # vitest
npm run build       # prisma generate + next build
npm run observe -- --dry-run
```

提交规范:每阶段独立提交;提交前 `git status` 确认只含本阶段相关文件;不混入密钥或无关改动;
验证未通过不得提交。提交信息用 `feat:`/`fix:`/`refactor:`/`docs:`/`chore:` 前缀简述阶段目标。

## 8. 机器强制的硬规则

`eslint.config.mjs` 已用 `no-restricted-imports` 强制以下两条(违反即 lint 失败):

1. **domain 纯净**:`src/domain/**` 不得 import `@/lib`、`@/server`、`@/app`、`@/components`、`@prisma/client`。
2. **DB 访问收敛**:除 `prisma.ts` / `prisma-store.ts` / `services/index.ts` 外,`src/**` 不得 import
   `@prisma/client` 或 `@/server/prisma`。

第 2、3 节的其余分层约定目前以本文件为契约(评审时人工把关),新增违规倾向时应优先补强 eslint 规则而非放宽约定。
