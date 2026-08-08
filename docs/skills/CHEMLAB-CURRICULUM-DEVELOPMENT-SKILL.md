# ChemLab Curriculum Development Skill

**Skill Name:** `chemlab-curriculum-development`  
**Version:** `1.0.0`  
**适用项目：** ChemLab-G9 及后续九年级化学数字化课程  
**适用范围：** 人教版九年级化学上册、下册、专题复习、中考复习课程

---

# 1. Skill 目标

本 Skill 用于指导 AI Agent / 开发团队，从教材分析开始，完整开发一套：

> **内容正确、结构稳定、可离线运行、适合 iPad、可持续迭代、具有学习诊断能力的九年级化学数字化学习系统。**

核心目标不是制作一个电子课件，而是建立：

```text
教材
 ↓
课程地图
 ↓
知识图谱
 ↓
实验体系
 ↓
题库
 ↓
错误诊断
 ↓
学习追踪
 ↓
个性化推荐
 ↓
AI Tutor
```

形成完整学习闭环：

```text
Learn
 ↓
Practice
 ↓
Diagnose
 ↓
Remediate
 ↓
Repractice
 ↓
Mastery
```

# 2. 核心开发原则

## 2.1 Schema First

必须遵循：

```text
Schema First
Content Second
Validation Third
UI Fourth
```

正确流程：

```text
教材分析
 ↓
数据模型
 ↓
知识图谱
 ↓
课程结构
 ↓
内容
 ↓
题库
 ↓
引擎
 ↓
UI
```

# 3. 不要把课程写死在程序里

课程必须是数据，而不是大量 `if (day === ...)`。

推荐通过稳定 ID 建立关联：

```javascript
{
  id: "V2-D12",
  knowledgeIds: ["V2-K001", "V2-K002"],
  experimentIds: ["V2-E004"],
  mistakeTypes: ["M-CONCEPT-001"],
  quizIds: ["V2-Q1201", "V2-Q1202"]
}
```

下册应成为同一学习平台的新课程数据，而不是重新开发一个网站。

# 4. 多册课程架构

推荐：

```text
content/
├── volume-1/
│   ├── manifest.js
│   ├── days/
│   ├── knowledge/
│   ├── experiments/
│   ├── mistakes/
│   └── quiz/
└── volume-2/
    ├── manifest.js
    ├── days/
    ├── knowledge/
    ├── experiments/
    ├── mistakes/
    └── quiz/
```

公共引擎：

```text
src/js/
├── learning-engine.js
├── knowledge-engine.js
├── lab-engine.js
├── ai-tutor.js
├── study-report.js
└── app.js
```

# 5. 教材分析工作流

新册开发必须先完成：

```text
教材
 ↓
章节
 ↓
课题
 ↓
知识点
 ↓
能力目标
 ↓
实验
 ↓
化学用语
 ↓
中考考点
 ↓
常见错误
 ↓
题型
```

不得直接从教材章节批量生成 Day 页面。

# 6. 课程地图

先建立完整课程地图，再进行 Day 划分。必须考虑：

- 前置知识
- 认知负荷
- 实验顺序
- 化学用语学习顺序
- 中考能力梯度

# 7. 每个 Day 的标准

每个课程日至少包含：

```text
Day
├── 学习目标
├── 核心问题
├── 核心知识
├── 微观解释
├── 实验/探究
├── 生活联系
├── 中考考点
├── 易错点
├── 知识卡片
├── 自测
└── 练习
```

推荐数据字段：

```javascript
{
  id: "V2-D01",
  dayNumber: 1,
  title: "...",
  coreQuestion: "...",
  learningObjectives: [],
  knowledgeIds: [],
  experimentIds: [],
  sections: [],
  checkpoint: {},
  quizIds: []
}
```

# 8. 化学知识图谱

知识点必须支持：

```text
Knowledge
├── prerequisite
├── relatedKnowledge
├── experiments
├── quizzes
├── mistakeTypes
├── examPoints
└── applications
```

目标是实现：

```text
学生答错
 ↓
错误类型
 ↓
知识缺口
 ↓
相关课程
 ↓
再次训练
```

# 9. 实验系统标准

实验至少包含：

```text
Experiment
├── purpose
├── materials
├── setup
├── steps
├── observations
├── conclusion
├── safety
├── commonErrors
└── examPoints
```

交互实验采用：

```text
准备
 ↓
操作
 ↓
观察
 ↓
判断
 ↓
解释
 ↓
结论
```

动画必须服务于“观察 → 判断 → 推理”，不能只是装饰。

# 10. 实验安全

涉及加热、点燃、酒精灯、白磷、CO、腐蚀性试剂、气体制备、燃烧等内容时，必须提供安全提示。不得为了交互性鼓励学生自行进行危险实验。

# 11. 题库标准

每道题至少：

```javascript
{
  id,
  prompt,
  options,
  answer,
  explanation,
  difficulty,
  topic,
  knowledgeIds,
  mistakeTypes
}
```

难度建议：基础、提升、挑战。

题目必须支持“为什么错”，不能只记录正确答案。

# 12. 错题诊断模型

```text
答错
 ↓
错误分类
 ↓
知识缺口
 ↓
能力缺口
 ↓
补救内容
 ↓
变式训练
 ↓
再次检测
```

错误类型至少包括：

- 概念混淆
- 化学用语错误
- 实验操作错误
- 现象判断错误
- 结论判断错误
- 计算错误
- 审题错误
- 条件遗漏

# 13. AI Tutor

AI Tutor 不是简单问答机器人，必须遵循：

```text
Student Error
 ↓
Diagnosis
 ↓
Explanation
 ↓
Remediation
 ↓
Practice
 ↓
Recheck
```

核心接口：

```javascript
analyzeMistake()
explainConcept()
explainMistake()
recommendReview()
generatePractice()
analyzeWeakness()
```

优先使用结构化知识、题目和错误数据进行诊断。

# 14. 学习引擎

至少追踪：

- 学习日期
- 完成课程
- 尝试次数
- 最佳成绩
- 知识掌握
- 错题
- 复习时间
- 连续学习

离线 localStorage 数据必须与身份无关，并可安全重置/导出。

# 15. 学习报告

学习报告应回答：

1. 学了多少：完成率、学习天数、连续学习。
2. 学会多少：知识掌握度。
3. 哪里不会：薄弱知识 TOP5。
4. 接下来学什么：课程、实验、题目推荐。

# 16. iPad / 离线优先

ChemLab 的核心产品特征是：不依赖服务器也能完整学习。

必须保持：

- 原生 HTML/CSS/JavaScript
- 无必要的外部 CDN 依赖
- 本地课程数据
- localStorage
- 单文件 HTML 构建
- iPad Safari 兼容

UI 基线：

- 触控目标 ≥ 44×44 CSS px
- 正文 ≥ 16px
- 不依赖 hover
- 支持暗色模式
- 支持 prefers-reduced-motion

# 17. P0 架构规则：新增 JS 必须进入离线构建

任何新增运行时 JS，例如：

```text
learning-engine.js
knowledge-engine.js
lab-engine.js
ai-tutor.js
study-report.js
```

都必须同步检查：

1. `index.html` 加载顺序
2. `scripts/build-single.mjs`
3. `dist/ChemLab-G9.html`
4. `tests/smoke.mjs`

禁止出现：

```text
开发环境正常
GitHub Pages 正常
dist 单文件离线运行失败
```

这是 P0 发布阻断项。

# 18. app.js 模块化规则

`app.js` 是 orchestration layer，不是所有业务逻辑的容器。

不得无限扩大 `app.js`。业务逻辑应逐步拆分为：

```text
learning-engine
knowledge-engine
lab-engine
ai-tutor
study-report
router
renderer
state
```

# 19. 内容与 UI 分离

内容文件负责“教什么”，程序负责“怎么展示”。

禁止在课程数据中大量嵌入 HTML。

# 20. SVG / 互动图标准

采用：

```text
数据
 ↓
SVG Renderer
 ↓
交互
```

避免每个 Day 复制一整套 SVG。共享图形状态必须有单一事实源，确保图、文字和交互一致。

# 21. 内容自动校验

Validator 必须检查：

- manifest
- Day/lesson
- Quiz
- ID 唯一性
- 必需字段
- 引用完整性
- knowledgeIds
- experimentIds
- quizIds
- mistakeTypes

禁止把课程数量、Day 数量和题数永久硬编码在 Validator 中。应从 manifest/config 动态读取。

# 22. 科学正确性发布门禁

科学检查采用分层机制：

```text
Rule Engine
 ↓
自动发现
 ↓
Warning
 ↓
AI/LLM Review
 ↓
教师审核
 ↓
Release
```

正则或关键词检查只是第一层防线，不能把“自动检查通过”等同于“科学正确”。尤其注意否定句、条件句、错误示例和易错点。

# 23. Smoke Test 规则

Smoke Test 应优先验证：

```text
每个 ready Day
 ↓
能加载
 ↓
能渲染
 ↓
有题目
 ↓
题目结构正确
 ↓
关键交互存在
```

避免把大量具体题数永久写死在测试中。课程内容调整不应该迫使测试脚本大规模修改。

# 24. 测试金字塔

最低发布门禁：

```bash
node scripts/validate-content.mjs
node scripts/check-science.mjs --fatal
node scripts/build-single.mjs
node tests/smoke.mjs
```

推荐测试层级：

```text
E2E
 ↓
Smoke / UI
 ↓
Engine
 ↓
Schema / Content
```

# 25. Git 开发工作流

采用小步提交：

```text
一个功能
 ↓
验证
 ↓
commit
 ↓
push
 ↓
下一功能
```

推荐 Conventional Commits：

```text
feat:
fix:
refactor:
test:
docs:
chore:
```

示例：

```text
feat(volume2): add chapter knowledge graph
feat(lab): add gas preparation simulator
test(content): validate volume2 knowledge references
fix(build): inline learning engines into offline bundle
```

# 26. AI Agent Git 工作协议

用户要求“继续开发”时，Agent 应执行：

```text
Inspect current branch
 ↓
Read recent commits
 ↓
Check working tree
 ↓
Inspect architecture
 ↓
Identify next task
 ↓
Modify code
 ↓
Run validation
 ↓
Run smoke test
 ↓
Inspect diff
 ↓
Commit
 ↓
Push
 ↓
Return commit SHA
```

如果 GitHub 权限失效，绝对禁止虚构 commit、push 或测试结果。必须明确说明当前无法写入 GitHub。

# 27. “继续”协议

当用户连续发送“继续”时，不应重复询问下一步。应自动进入：

```text
Inspect
→ Implement
→ Test
→ Commit
→ Push
→ Report
```

# 28. PR / Issue Review

合并前检查：

```text
PR
 ↓
Changed files
 ↓
Checks
 ↓
Architecture
 ↓
Content
 ↓
Science
 ↓
iPad
 ↓
Offline build
```

问题分类：

- P0：阻断发布
- P1：严重问题
- P2：普通问题
- P3：优化建议

# 29. Volume 2 正确开发顺序

不得直接从 Day01 开始。

```text
Phase 0  平台架构检查
 ↓
Phase 1  课程 Schema
 ↓
Phase 2  知识图谱
 ↓
Phase 3  实验模型
 ↓
Phase 4  题库模型
 ↓
Phase 5  课程内容
 ↓
Phase 6  学习引擎
 ↓
Phase 7  AI Tutor
 ↓
Phase 8  测试
 ↓
Phase 9  发布
```

# 30. Volume 2 开发前 Checklist

## Architecture

- [ ] 支持多册
- [ ] 存在 volume/course ID
- [ ] Day ID 不冲突
- [ ] 新增 JS 已进入 build pipeline
- [ ] dist 完全自包含
- [ ] app.js 没有继续失控膨胀

## Content

- [ ] 教材分析完成
- [ ] 课程地图完成
- [ ] 知识图谱完成
- [ ] 实验地图完成
- [ ] 题型地图完成
- [ ] 易错点地图完成

## Data

- [ ] ID 唯一
- [ ] knowledgeIds 有效
- [ ] experimentIds 有效
- [ ] quizIds 有效
- [ ] mistakeTypes 有效

## Science

- [ ] 自动科学巡检
- [ ] AI 复核
- [ ] 教师审核
- [ ] 实验安全检查

## UX

- [ ] iPad
- [ ] Safari
- [ ] 触控
- [ ] 暗色模式
- [ ] 减弱动态效果
- [ ] 无 hover 依赖

## Build

- [ ] content validation
- [ ] science validation
- [ ] single-file build
- [ ] smoke test
- [ ] offline test

## Git

- [ ] 小步 commit
- [ ] commit message 清晰
- [ ] push 后验证远程
- [ ] 记录 SHA
- [ ] PR review

# 31. 最终生产流水线

```text
START
 ↓
Inspect Repository
 ↓
Analyze Textbook
 ↓
Curriculum Map
 ↓
Knowledge Graph
 ↓
Experiments + Quiz Map
 ↓
Mistake Model
 ↓
Generate Lessons
 ↓
Content Validation
 ↓
Science Validation
 ↓
Engine Integration
 ↓
UI Integration
 ↓
Build Offline HTML
 ↓
Smoke Test
 ↓
iPad Verification
 ↓
Git Diff
 ↓
Commit
 ↓
Push
 ↓
Release
```

# 32. 五层质量门禁

ChemLab 的完成标准不是页面漂亮，而是五层质量同时成立：

```text
教学正确
 ↓
科学正确
 ↓
数据正确
 ↓
工程稳定
 ↓
学习有效
```

任何一层失败，都不能称为完成。

# 33. Skill 输出

执行本 Skill 后应产生：

```text
1. Curriculum Map
2. Knowledge Graph
3. Experiment Map
4. Quiz Bank
5. Mistake Taxonomy
6. Daily Lessons
7. Learning Engine Integration
8. AI Tutor Integration
9. Validation Scripts
10. Offline Build
11. Smoke Tests
12. Git Commits
13. Release Report
```

# 34. 最终原则

ChemLab 不应该成为“一套写死的化学网页”，而应该成为：

> **一个由课程数据驱动、由学习引擎驱动、由知识图谱连接、由实验和题库支撑、由 AI Tutor 提供个性化反馈的化学学习平台。**

因此下册开发的核心原则只有一句：

# Build the Curriculum Engine, Not Just the Curriculum.

不要只开发下册课程，要开发能够持续生产下册、复习课、中考专题以及未来其他课程的课程引擎。

# 35. Versioning

```text
v1.0 → Curriculum Design + Knowledge + Lab + Quiz + Mistake + Learning + AI + Validation + Offline Build + iPad + Git
v1.1 → Multi-volume architecture
v1.2 → Automated content generation
v1.3 → AI teacher review
v1.4 → Adaptive learning
v2.0 → Multi-subject curriculum engine
```
