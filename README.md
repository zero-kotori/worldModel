## 核心工作流

WorldModel 将信念更新建模为一条可审计的证据流水线：

```mermaid
flowchart LR
  Belief["信念<br/>当前判断主题是什么？"]
  Hypothesis["假设<br/>哪个具体命题会改变？"]
  Observation["观察<br/>来源产出了什么信息？"]
  Evidence["证据<br/>哪些观察已被确认？"]
  Likelihood["似然评分<br/>它支持还是削弱假设？"]
  Update["贝叶斯更新<br/>概率应该如何变化？"]
  Audit["审计 / 回滚<br/>为什么变化，如何撤销？"]

  Belief --> Hypothesis
  Hypothesis --> Observation
  Observation --> Evidence
  Evidence --> Likelihood
  Likelihood --> Update
  Update --> Audit
  Audit -.复核.-> Evidence
```

系统最重要的边界是：观察不会直接改变概率。RSS、GitHub、Hugging Face、GDELT、Polymarket 或手动录入产生的信息会先进入观察池；只有当观察被确认为证据、关联到一个或多个假设、完成相关性和似然评分，并通过贝叶斯更新事件应用后，才会影响假设概率。

每次更新都会保存先验快照、后验快照、证据关联、似然输出、置信度、解释和回滚状态。因此系统可以追踪概率变化的完整原因，并在证据判断或模型评分有误时安全回滚。

## 技术亮点

- **证据图谱数据模型**：信念、假设、来源、观察、证据、证据-假设关联、似然运行和贝叶斯更新事件共同构成可追踪图谱。
- **纯函数贝叶斯核心**：`src/domain` 中的 TypeScript 纯函数负责独立假设、互斥假设、似然合成、去重和更新预览，不依赖 UI、数据库或框架。
- **自动证据闭环**：活跃假设生成搜索计划，启用来源采集观察，重复和低影响观察进入专门队列，强候选只有通过安全检查后才允许自动确认。
- **Query Planner**：有人工 `evidenceSearchQuery` 时优先使用人工查询；比较型假设会生成 benchmark、comparison 和预测市场查询；未覆盖场景回退到清洗后的基础查询。
- **LLM 辅助似然评分和保守保护**：LLM 输出方向、相关性、似然比、置信度、解释和是否需要复核；当模型质量或假设覆盖存在风险时，自动应用会降级为仅待审。
- **观察清理策略**：重复候选默认拒绝；未知观察和低影响观察可以在单次闭环或 worker 配置中选择保留、拒绝或软删除。
- **关系图谱工作区**：UI 支持聚焦节点、只看相关子图、编辑图谱侧记录，并默认隐藏已归档、已拒绝或已删除实体。
- **可审计自动化**：每次 observation run 都记录采集数量、去重数量、候选数量、自动应用数量、待审数量、低影响数量、未匹配数量、查询摘要和错误。
- **工程化测试覆盖**：测试覆盖领域逻辑、服务层工作流、API 路由、UI 渲染、脚本、来源适配器、worker、鉴权和迁移安全。

## 架构设计

代码按依赖方向分层，让概率引擎和业务规则可以脱离 UI 与数据库单独测试：

```text
app / components
  Next.js 路由、Server Actions、React UI
        |
        v
server
  服务层、Prisma Store、来源适配器、自动化 worker、模型接入
        |
        v
lib
  面向 UI 的纯 helper、图谱布局、展示模型、路由 helper
        |
        v
domain
  纯贝叶斯更新、似然合成、去重、更新预览
```

关键实现目录：

```text
src/domain/
  bayes.ts, likelihood.ts, dedupe.ts, updates.ts

src/server/services/
  belief-service.ts
  observation-service.ts
  evidence-service.ts
  likelihood-service.ts
  update-service.ts
  source-service.ts
  automation-service.ts
  model-service.ts
  prisma-store.ts
  in-memory-store.ts

src/server/services/internal/
  query-planner.ts
  evidence-queries.ts
  recommendations.ts
  schemas.ts
  shared.ts

src/components/world-model/
  WorldModelGraphView.tsx
  WorldModelNav.tsx
  Field.tsx
  PendingSubmitButton.tsx
```

数据库访问被收敛在 `WorldModelStore` 后面。服务层依赖 store 接口，而不是直接 import Prisma，这样内存实现和 Prisma 实现可以共享同一套业务语义与测试覆盖。

## UI 功能概览

后台 UI 位于 `/admin/world-model/*`。

- `/admin/world-model`：总览摘要、自动化健康状态、待处理入口和最近更新。
- `/admin/world-model/graph`：主要关系图谱工作区，用于查看来源、信念、假设、观察、证据和更新事件。
- `/admin/world-model/beliefs`：信念表、假设、概率结构、状态变更和假设推荐。
- `/admin/world-model/observations`：待审候选、未知证据队列、重复候选、批量清理、手动观察录入和确认入口。
- `/admin/world-model/evidence`：证据库、证据-假设关联、更新预览、应用/重应用、拒绝/删除和回滚。
- `/admin/world-model/sources`：来源 preset、来源配置、dry-run、自动证据闭环、清理策略和 worker 配置。
- `/admin/world-model/models`：LLM 配置、评估结果、训练样本抓取、轻量模型训练、模型产物导入和似然审计。

## 本地开发

没有 `myWeb` 作为入口时，使用 standalone 模式。

1. 安装依赖：

   ```bash
   npm install
   ```

2. 启动项目自带的 Docker Postgres：

   ```bash
   docker compose up -d postgres
   ```

3. 创建本地环境变量文件：

   ```bash
   cp .env.example .env.local
   ```

   默认 `.env.example` 已适配 Docker Postgres：

   ```env
   WORLDMODEL_DATABASE_URL="postgresql://postgres:postgres@localhost:5433/worldmodel?schema=public"
   WORLDMODEL_ACCESS_MODE="standalone"
   ```

4. 应用数据库迁移：

   ```bash
   set -a
   . ./.env.local
   set +a
   npx prisma migrate deploy
   ```

5. 启动应用：

   ```bash
   npm run dev
   ```

6. 打开：

   ```text
   http://localhost:3100/admin/world-model
   ```

如果希望用 Docker 管理应用进程，而不是 `npm run dev`：

```bash
docker compose up -d --build
```

## myWeb 代理模式

当 `myWeb` 提供受保护的管理员入口时，使用 proxy 模式。

在 `worldModel/.env.local` 中配置：

```env
WORLDMODEL_ACCESS_MODE="proxy"
WORLDMODEL_PROXY_SECRET="same-random-secret-as-myWeb"
```

在 `myWeb/.env.local` 中配置：

```env
WORLDMODEL_BASE_URL="http://127.0.0.1:3100"
WORLDMODEL_PROXY_SECRET="same-random-secret-as-worldModel"
```

proxy 模式下，未带内部签名的直接请求会返回 `401`。

## 验证命令

```bash
npm run lint
npm run typecheck
npm run test
npm run build
npm run observe -- --dry-run
```

浏览器验收需要先启动应用，再运行：

```bash
npm run test:browser
```

当前回归测试覆盖 700+ 条用例，范围包括领域逻辑、服务层、API 路由、UI 页面、来源适配器、自动化 worker、脚本、鉴权和迁移检查。

## 项目文档

- [产品需求](docs/ai/world-model-requirements.md)
- [技术设计](docs/ai/world-model-technical-design.md)
- [UI 使用说明](docs/ai/world-model-ui-guide.md)
- [部署与运行说明](docs/ai/world-model-rollout.md)
