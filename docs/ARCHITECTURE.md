# ChemLab-G9 V3.1 架构规范

## 技术原则

- 单页、静态、离线优先：入口为根目录 `index.html`；发布形态为 `dist/ChemLab-G9.html` 单个自包含文件，可直接在 iPad 离线打开。
- 原生 HTML / CSS / JavaScript，不引入框架、打包器或外部 CDN。
- 内容与界面分离：课程内容放在 `content/`，题目放在 `quiz/`，渲染逻辑放在 `src/`。
- 以语义化标签和可访问性优先；所有互动均需有非动画的文字信息。
- 内容数据在开发期以多个 JS 文件维护，发布期由 `scripts/build-single.mjs` 内联为单文件。

## 代码职责

| 路径 | 职责 |
| --- | --- |
| `index.html` | 页面外壳、无脚本提示、只静态加载 `manifest.js` 与 `app.js` |
| `src/css/app.css` | 色彩令牌、排版、响应式、暗色模式与组件样式 |
| `src/js/app.js` | 路由（首页 / 某天 / 错题复习）、状态、渲染、进度与错题队列、本地保存、SVG 配图 |
| `content/manifest.js` | 30 天的清单：标题、所属模块、是否已可学习（`ready`） |
| `content/days/day-XX.js` | 某天的教学内容对象 |
| `quiz/day-XX.js` | 某天的题目对象 |
| `scripts/validate-content.mjs` | 内容数据一致性校验（生产前必跑） |
| `scripts/build-single.mjs` | 单文件构建：内联 manifest / 天 / 题目 / 样式 / 逻辑 |
| `tests/smoke.mjs` | 构建产物冒烟测试 |
| `assets/` | 经审核可用的本地媒体资源 |

## 内容加载约定

课程和题目文件以 `window.ChemLabContent` 与 `window.ChemLabQuiz` 注册。`index.html` 只静态加载 `content/manifest.js` 和 `src/js/app.js`。

两种运行形态，逻辑同一套：

- **开发分离模式**：`app.js` 依据 URL 参数 `?day=XX` 动态插入 `<script>` 加载 `content/days/day-XX.js` 与 `quiz/day-XX.js`。与静态 script 标签同源，双击打开 `index.html` 仍可工作，不受浏览器 `fetch` 本地文件限制。
- **单文件发布模式**：`build-single.mjs` 先把 manifest 与所有 `ready` 天的内容、题目内联进 HTML（顺序：manifest → 各天内容 → 各天题目 → app.js），`app.js` 优先读取已注册的内容，命中则直接渲染，不再发起外部加载。

未传 `day` 参数时渲染首页：读取 `manifest.js` 与本地进度，展示学习日导航网格；某天若 `ready` 为 `false`，点击不可用，直接提示"开发中"。`?view=review` 渲染错题复习页，内容同样先查内联、不足则动态加载。

## 状态保存

使用 `localStorage`，键名以 `chemlab-g9:v3:` 开头，且仅保存与身份无关的学习数据：

| 键 | 内容 |
| --- | --- |
| `chemlab-g9:v3:day-XX` | 该天的尝试历史 `{ attempts: [{score, total, answers, completedAt}], best }`，重做追加而非覆盖；旧版单快照记录读取时自动迁移 |
| `chemlab-g9:v3:review` | 跨天错题复习队列：`{day, questionIndex, prompt, answeredAt}`，可据此重新作答指定题并维护"答对移除、答错保留" |

不保存姓名、账号等个人身份信息。

## 配图与 SVG 图元库

配图由 `src/js/app.js` 内建 SVG 渲染器绘制，不在数据里塞 HTML。`figure.type` 决定渲染器：

- `cylinder-reading`：量筒读数视角对比（平视/俯视/仰视可切换）
- `airtight-test`：检查装置气密性（气泡动画，不漏气/漏气可切换）
- `graduated-cylinder`：量筒静态示意

可复用的 SVG 图元（渐变、玻璃器皿描边、烧杯、气泡等）收在 `svgParts`，新配图按需组装，避免每个图重写整段 SVG。量筒读数的几何与文案是单一事实源 `CYLINDER_STATES`，渲染与交互共用同一份数据。

## 题目数据约定

`quiz/day-XX.js` 中每题字段：`prompt`、`options`（≥2 项）、`answer`（正确选项下标字符串，须在选项范围内）、`explanation`、可选 `difficulty`（基础 / 提升 / 挑战）。发布前用 `scripts/validate-content.mjs` 校验。

## iPad 设计基线

- 最小触控目标：44 × 44 CSS px。
- 内容最大宽度：920px，正文行长控制在易读范围。
- 不依赖 hover；系统减少动态效果时关闭非必要过渡。
- 使用系统中文字体栈，默认文字大小不小于 16px。
- 支持系统暗色模式与「减弱动态效果」。
