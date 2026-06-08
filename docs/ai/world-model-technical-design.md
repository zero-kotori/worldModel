# 世界模型工具技术设计文档

## 1. 总体架构

`worldModel` 作为独立 Next.js 全栈应用运行，拥有自己的 UI、API、领域逻辑、Prisma schema 和 Postgres 数据库。现有个人网站 `myWeb` 不直接承载世界模型业务逻辑，只负责提供管理员入口和同域代理。

访问链路如下：

1. 用户访问 `myWeb` 的 `/admin/world-model/*`。
2. `myWeb` 调用现有 `requireAdmin()` 校验管理员登录。
3. 校验通过后，`myWeb` 将请求代理到 `worldModel` 服务。
4. 代理请求包含内部签名头。
5. `worldModel` 校验签名、时间戳、路径和请求摘要。
6. 校验通过后返回完整 UI 或 API 响应。

该设计保证：

- 世界模型可以独立开发、测试、部署和备份。
- 世界模型数据不污染 `myWeb` 的内容数据库。
- 用户体验上仍然像在同一个后台中访问完整工具。
- 即使 `worldModel` 端口被误暴露，也不能绕过内部签名直接访问。

## 2. 目录结构

`/home/ubuntu/worldModel` 规划为独立应用根目录：

```text
worldModel/
  docs/
    ai/
      world-model-requirements.md
      world-model-technical-design.md
  prisma/
    schema.prisma
    migrations/
  scripts/
    observe.ts
    model-import.ts
    train_prepare.py
    train_light.py
  src/
    app/
      admin/
        world-model/
          page.tsx
          beliefs/
          observations/
          evidence/
          sources/
          models/
      api/
        beliefs/
        hypotheses/
        observations/
        evidence/
        updates/
        sources/
        models/
    components/
    domain/
      bayes.ts
      belief.ts
      dedupe.ts
      evidence.ts
      likelihood.ts
      updates.ts
    lib/
      env.ts
      math.ts
      validation.ts
    server/
      prisma.ts
      proxy-auth.ts
      services/
      sources/
      models/
  tests/
```

`../myWeb` 只需要少量集成改动：

```text
myWeb/
  src/
    app/
      admin/
        world-model/
          [...path]/
            route.ts
    components/
      AdminNav.tsx
  .env.example
```

## 3. 技术栈

- Next.js App Router：承载 UI 和 API。
- React：实现后台操作界面。
- TypeScript：实现领域逻辑、服务层和 API。
- Prisma：管理独立世界模型数据库。
- Postgres：存储信念、假设、观察、证据、更新事件和模型产物。
- Tailwind CSS：实现后台 UI。
- Vitest：测试纯领域逻辑和服务层。
- Python：训练数据准备、LLM 评分评估和轻量 fallback 模型训练。
- OpenAI-compatible adapter：作为 v1 主似然评分通道，支持 DeepSeek、OpenAI 和本地兼容接口。
- cron 或 systemd timer：触发观察采集脚本。

## 4. 环境变量

`worldModel` 需要：

```env
WORLDMODEL_DATABASE_URL="postgresql://..."
WORLDMODEL_PROXY_SECRET="replace-with-a-long-random-secret"
WORLDMODEL_PUBLIC_BASE_PATH="/admin/world-model"
LLM_PROVIDER="deepseek|openai|local"
LLM_BASE_URL=""
LLM_API_KEY=""
LLM_MODEL=""
MODEL_ARTIFACT_DIR="./model-artifacts"
```

`myWeb` 需要：

```env
WORLDMODEL_BASE_URL="http://127.0.0.1:3100"
WORLDMODEL_PROXY_SECRET="same-secret-as-worldmodel"
```

真实密钥只写入本地或部署环境，不写入 Git。

## 5. 数据模型

### 5.1 Belief

信念表保存判断主题。

字段：

- `id`
- `title`
- `category`
- `description`
- `probabilityMode`
- `status`
- `createdAt`
- `updatedAt`

枚举：

- `category`: `AI_TREND`、`INVESTMENT`、`TECH_TREND`、`CAREER`、`SOURCE_RELIABILITY`
- `probabilityMode`: `MUTUALLY_EXCLUSIVE`、`INDEPENDENT`
- `status`: `ACTIVE`、`PAUSED`、`ARCHIVED`

### 5.2 Hypothesis

假设表保存可更新概率的具体命题。

字段：

- `id`
- `beliefId`
- `proposition`
- `notes`
- `priorProbability`
- `currentProbability`
- `strength`
- `status`
- `startsAt`
- `expiresAt`
- `expiryCondition`
- `resolvedOutcome`
- `createdAt`
- `updatedAt`

状态：

- `ACTIVE`
- `PAUSED`
- `RESOLVED_TRUE`
- `RESOLVED_FALSE`
- `ARCHIVED`

### 5.3 ObservationSource

观察来源表保存采集配置。

字段：

- `id`
- `name`
- `kind`
- `url`
- `adapter`
- `credentialRef`
- `credibility`
- `enabled`
- `autoConfirm`
- `autoConfirmThreshold`
- `createdAt`
- `updatedAt`

凭据只保存引用名，例如 `X_COOKIE_PROFILE_1`，实际值从环境变量或本地密钥文件读取。

### 5.4 Observation

观察表保存原始候选信息。

字段：

- `id`
- `sourceId`
- `title`
- `content`
- `url`
- `author`
- `publishedAt`
- `observedAt`
- `normalizedHash`
- `semanticKey`
- `status`
- `duplicateOfId`
- `credibility`
- `metadata`

状态：

- `PENDING`
- `DUPLICATE`
- `UNKNOWN`
- `CONFIRMED`
- `REJECTED`

### 5.5 Evidence

证据表保存已确认信息。

字段：

- `id`
- `observationId`
- `title`
- `content`
- `url`
- `confirmedAt`
- `confirmationMode`
- `credibility`
- `status`
- `metadata`

确认方式：

- `MANUAL`
- `AUTO`

### 5.6 EvidenceHypothesisLink

证据和假设是多对多关系。该表保存每一条证据对每一个假设的影响。

字段：

- `id`
- `evidenceId`
- `hypothesisId`
- `direction`
- `relevance`
- `likelihoodRatio`
- `confidence`
- `rationale`
- `createdAt`

方向：

- `SUPPORTS`
- `OPPOSES`
- `MIXED`
- `NEUTRAL`

### 5.7 LikelihoodRun

似然运行表保存模型输出。

字段：

- `id`
- `evidenceId`
- `hypothesisId`
- `ensembleLikelihoodRatio`
- `ensembleConfidence`
- `estimatorOutputs`
- `modelVersion`
- `createdAt`

`estimatorOutputs` 使用 JSON 保存每个 estimator 的输出、弃权状态、权重和解释。

### 5.8 BayesianUpdateEvent

更新事件表保存概率变化审计记录。

字段：

- `id`
- `beliefId`
- `evidenceId`
- `likelihoodRunId`
- `priorSnapshot`
- `posteriorSnapshot`
- `mode`
- `status`
- `createdAt`
- `rolledBackAt`

快照字段使用 JSON，保存更新前后的假设概率集合。

### 5.9 ObservationRun

采集运行表保存每次来源拉取状态。

字段：

- `id`
- `sourceId`
- `status`
- `startedAt`
- `finishedAt`
- `itemCount`
- `deduplicatedCount`
- `errorMessage`

### 5.10 ModelArtifact

模型产物表保存可用模型版本。

字段：

- `id`
- `name`
- `kind`
- `version`
- `path`
- `metrics`
- `enabled`
- `createdAt`

## 6. 领域算法

### 6.1 独立假设更新

独立假设使用 odds 形式更新。

```text
priorOdds = prior / (1 - prior)
discountedLikelihoodRatio = 1 + credibility * (likelihoodRatio - 1)
posteriorOdds = priorOdds * discountedLikelihoodRatio
posterior = posteriorOdds / (1 + posteriorOdds)
```

约束：

- `prior` 必须在 0 到 1 之间。
- `likelihoodRatio` 必须大于 0。
- `credibility` 必须在 0 到 1 之间。
- 输出需要限制在 0 到 1 之间。

### 6.2 互斥完备假设更新

互斥完备模式下，对每条假设计算未归一化后验权重：

```text
discountedLR[i] = 1 + credibility * (likelihoodRatio[i] - 1)
rawPosterior[i] = prior[i] * discountedLR[i]
posterior[i] = rawPosterior[i] / sum(rawPosterior)
```

约束：

- 输入概率可以先归一化。
- 如果所有 raw posterior 总和为 0，则回退到原始归一化先验。
- 输出概率总和必须为 1。

### 6.3 似然 ensemble

每个 estimator 输出：

```ts
type EstimatorOutput = {
  estimator: string;
  likelihoodRatio?: number;
  confidence?: number;
  weight: number;
  rationale?: string;
  abstain?: boolean;
  modelVersion?: string;
};
```

合成规则：

- 忽略 `abstain = true` 的 estimator。
- 忽略缺少有效 `likelihoodRatio` 或 `confidence` 的输出。
- 使用 `weight * confidence` 作为有效权重。
- 对 likelihood ratio 采用对数空间加权平均，避免极端值直接支配结果。
- 如果所有 estimator 都弃权，则返回 `reviewRequired = true`，不自动更新。

### 6.4 去重

去重输出：

```ts
type DuplicateDecision = {
  duplicate: boolean;
  reason: "URL" | "HASH" | "SEMANTIC" | "NONE";
  duplicateOfId?: string;
  confidence: number;
};
```

优先级：

1. URL 完全匹配。
2. 规范化文本 hash 匹配。
3. 语义 key 匹配且发布时间接近。
4. 无重复。

疑似重复观察进入 `DUPLICATE` 状态，不直接删除。

## 7. 服务层设计

服务层位于 `src/server/services`。

建议模块：

- `belief-service.ts`
  - 创建、更新、归档信念。
  - 创建、更新、结算假设。
  - 校验概率结构。
- `observation-service.ts`
  - 写入观察。
  - 执行去重。
  - 标记未知、重复、拒绝或确认。
- `evidence-service.ts`
  - 将观察确认为证据。
  - 建立证据和假设关联。
  - 生成更新预览。
- `likelihood-service.ts`
  - 调用 estimator。
  - 保存 likelihood run。
  - 返回 ensemble 结果。
- `update-service.ts`
  - 应用贝叶斯更新。
  - 保存更新事件。
  - 回滚更新事件。
- `source-service.ts`
  - 管理来源配置。
  - 运行采集 adapter。
  - 保存 observation run。
- `model-service.ts`
  - 管理模型产物。
  - 调用 LLM API 主评分器。
  - 加载轻量 fallback 模型。
  - 配置 estimator 权重。

服务层必须进行输入校验，避免 UI 或 API 直接写入不合法概率、状态或 JSON。

## 8. API 设计

API 仅面向后台 UI 使用。

主要路由：

- `GET /api/beliefs`
- `POST /api/beliefs`
- `PATCH /api/beliefs/:id`
- `POST /api/beliefs/:id/hypotheses`
- `PATCH /api/hypotheses/:id`
- `GET /api/observations`
- `POST /api/observations`
- `POST /api/observations/:id/confirm`
- `POST /api/observations/:id/reject`
- `GET /api/evidence`
- `POST /api/evidence/:id/link`
- `POST /api/evidence/:id/preview-update`
- `POST /api/evidence/:id/apply-update`
- `POST /api/updates/:id/rollback`
- `GET /api/sources`
- `POST /api/sources`
- `POST /api/sources/:id/run`
- `GET /api/models`
- `POST /api/models/import`

所有 API 都必须经过内部代理签名校验。

## 9. UI 设计

后台 UI 页面：

- `/admin/world-model`
  - 总览：信念数量、活跃假设、待处理观察、已确认信据、最近更新。
- `/admin/world-model/beliefs`
  - 信念列表、创建表单、假设编辑、概率结构选择。
- `/admin/world-model/observations`
  - 观察池、重复候选、未知证据、确认和拒绝操作。
- `/admin/world-model/evidence`
  - 证据库、假设关联、更新预览、应用更新。
- `/admin/world-model/sources`
  - 来源配置、可信度、adapter、自动确认阈值、手动运行。
- `/admin/world-model/models`
  - 模型版本、estimator 权重、模型健康状态、产物导入。

UI 风格要求：

- 面向高频管理操作，布局应紧凑、可扫描。
- 不做营销页、hero 页或装饰性页面。
- 表格、筛选、状态标签、操作按钮要清晰。
- 概率变化和模型解释需要可追溯。
- 移动端不要求复杂编辑体验最优，但不能出现文本重叠或页面空白。

## 10. myWeb 代理设计

`myWeb` 新增代理路由：

```text
/admin/world-model/[...path]/route.ts
```

代理处理流程：

1. 调用 `requireAdmin()`。
2. 读取目标 path、query、method、headers 和 body。
3. 使用 `WORLDMODEL_PROXY_SECRET` 生成签名。
4. 转发到 `WORLDMODEL_BASE_URL`。
5. 返回 worldModel 响应。

签名建议包含：

- HTTP method。
- path 和 query。
- timestamp。
- body hash。

`worldModel` 端校验：

- timestamp 未过期。
- 签名匹配。
- path 和 method 未被篡改。
- body hash 匹配。

## 11. 观察采集设计

采集脚本入口：

```bash
npm run observe
npm run observe -- --dry-run
npm run observe -- --source <source-id>
```

adapter 统一输出：

```ts
type RawObservation = {
  title: string;
  content: string;
  url?: string;
  author?: string;
  publishedAt?: Date;
  sourceMetadata?: Record<string, unknown>;
};
```

第一版 adapter：

- 手动输入。
- RSS。
- 通用网页。
- 搜索结果。
- GitHub。
- Hugging Face。
- GDELT 或新闻事件。
- 预测市场 API。
- 社交平台命令行适配器。

社交平台凭据由环境变量或本地密钥文件提供。adapter 不应把真实凭据写入日志或数据库。

## 12. 模型训练设计

训练脚本：

```bash
npm run train:prepare
npm run train:light
npm run model:import
```

训练和评估脚本职责：

- 下载或读取公开数据源。
- 抽取 claim、evidence、outcome、timestamp、source 等字段。
- 转换为统一训练样本。
- 使用真实样本评估 LLM API 主评分器。
- 可选训练轻量可解释 fallback 模型。
- 导出评分评估结果、模型产物和指标 JSON。

训练数据来源：

- FEVER。
- SciFact。
- Metaculus。
- Polymarket。
- Manifold。
- GDELT。
- GH Archive。
- Hugging Face Hub。

如果服务器算力不足，训练脚本应可以在用户本地电脑运行，产出文件再复制到服务器并通过 `model:import` 注册。

## 13. 测试策略

### 13.1 单元测试

覆盖：

- 独立假设贝叶斯更新。
- 互斥完备假设归一化更新。
- 可信度对似然比的折扣。
- estimator 加权合成和弃权。
- URL、hash、语义 key 去重。
- 更新事件回滚。

### 13.2 集成测试

覆盖：

- 创建信念和假设。
- 写入观察。
- 确认观察为证据。
- 一条证据关联多个假设。
- 生成似然运行记录。
- 应用更新。
- 回滚更新。
- 导入模型产物。

### 13.3 代理测试

覆盖：

- 未登录 `myWeb` 时无法访问代理入口。
- 登录后代理请求包含内部签名。
- `worldModel` 拒绝无签名请求。
- `worldModel` 拒绝过期签名。
- `worldModel` 拒绝 body hash 不匹配请求。

### 13.4 浏览器验收

覆盖：

- dashboard。
- beliefs。
- observations。
- evidence。
- sources。
- models。

至少检查桌面和移动端页面不空白、核心文案存在、主要操作按钮可见、文本不重叠。

## 14. 验证命令

`worldModel`：

```bash
npm run lint
npm run typecheck
npm run test
npm run build
npm run acceptance:auto-loop
npm run observe -- --dry-run
```

`myWeb`：

```bash
npm run typecheck
npm run build
```

如果代理或导航改动影响现有验收脚本，还需要运行 `myWeb` 已有的浏览器或验收检查。

## 15. 阶段提交规范

项目已经初始化 Git 仓库。每一个阶段必须在测试和验收完成后用 Git 提交保存，避免多个阶段混在同一个提交里。

通用流程：

```bash
git status --short
# 运行本阶段相关验证命令
git status --short
git add <本阶段相关文件>
git commit -m "<type>: <stage summary>"
```

提交前必须确认：

- 本阶段相关测试、类型检查、构建或浏览器验收已经运行。
- 命令输出显示通过，或者失败原因和剩余风险已经记录且不进行提交。
- `git status` 中没有无关文件、临时文件、密钥文件或测试产物。
- 不提交 `.env`、`.env.local`、cookie、token、API key、密码或真实模型密钥。
- 不把 `../myWeb` 的无关改动和 `worldModel` 的阶段改动混在一起。

阶段提交建议：

| 阶段 | 验证完成后提交信息示例 |
| --- | --- |
| 脚手架 | `feat: scaffold world model app` |
| 领域逻辑 | `feat: add bayesian update core` |
| 数据模型和服务层 | `feat: add world model persistence` |
| 后台 UI | `feat: add world model admin UI` |
| myWeb 代理 | `feat: add signed world model proxy` |
| 观察采集 | `feat: add observation ingestion pipeline` |
| 似然模型和训练 | `feat: add likelihood model pipeline` |
| 全量验收和文档 | `docs: finalize world model rollout notes` |

如果某阶段同时改动 `worldModel` 和 `../myWeb`，需要先检查两个仓库各自的 `git status`。若 `../myWeb` 仍是独立 Git 仓库，则应在对应仓库分别提交，不能只在当前仓库提交跨仓库改动。

## 16. 实施顺序

1. 搭建 `worldModel` Next.js 项目和基础验证命令。
   - 验收后提交：`feat: scaffold world model app`。
2. 先用测试驱动实现纯领域逻辑。
   - 验收后提交：`feat: add bayesian update core`。
3. 添加 Prisma schema、迁移和服务层。
   - 验收后提交：`feat: add world model persistence`。
4. 实现后台 UI。
   - 验收后提交：`feat: add world model admin UI`。
5. 实现 `myWeb` 同域代理和 `worldModel` 内部签名校验。
   - 验收后提交：`feat: add signed world model proxy`。
6. 实现观察来源、去重和观察池。
   - 验收后提交：`feat: add observation ingestion pipeline`。
7. 实现似然 estimator、模型产物加载和训练脚本。
   - 验收后提交：`feat: add likelihood model pipeline`。
8. 补齐集成测试、浏览器验收和部署说明。
   - 验收后提交：`docs: finalize world model rollout notes`。

## 17. 主要风险

- 公开训练数据和个人假设语境不完全一致，可能导致似然模型偏差。
- 社交平台采集受 cookie、风控和平台规则影响，稳定性不可保证。
- 自动确认证据可能带来错误概率更新。
- 代理配置错误可能暴露私有数据。
- 重模型训练可能超出服务器算力。

对应缓解：

- 保留 estimator 解释、置信度和弃权机制。
- 默认人工确认，自动确认只对特定来源和阈值开放。
- 所有更新事件可审计、可回滚。
- 采集凭据不入库、不入 Git。
- 训练产物可迁移，支持本地训练后导入。
