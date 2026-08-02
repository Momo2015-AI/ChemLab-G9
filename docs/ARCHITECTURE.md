# ChemLab-G9 V3.0 架构规范

## 技术原则

- 单页、静态、离线优先：入口为根目录 `index.html`。
- 原生 HTML / CSS / JavaScript，不引入框架、打包器或外部 CDN。
- 内容与界面分离：课程内容放在 `content/`，题目放在 `quiz/`，渲染逻辑放在 `src/`。
- 以语义化标签和可访问性优先；所有互动均需有非动画的文字信息。

## 代码职责

| 路径 | 职责 |
| --- | --- |
| `index.html` | 页面外壳、无脚本提示、只静态加载 `manifest.js` 与 `app.js` |
| `src/css/app.css` | 色彩令牌、排版、响应式和组件样式 |
| `src/js/app.js` | 路由（首页 / 某天）、状态、渲染、进度与错题队列、本地保存 |
| `content/manifest.js` | 30 天的清单：标题、所属模块、是否已可学习（`ready`） |
| `content/days/day-XX.js` | 某天的教学内容对象 |
| `quiz/day-XX.js` | 某天的题目对象 |
| `assets/` | 经审核可用的本地媒体资源 |

## 内容加载约定

课程和题目文件以 `window.ChemLabContent` 与 `window.ChemLabQuiz` 注册。`index.html` 只静态加载 `content/manifest.js` 和 `src/js/app.js`；具体某一天的 `content/days/day-XX.js` 与 `quiz/day-XX.js` 由 `app.js` 依据 URL 参数 `?day=XX` 动态插入 `<script>` 标签加载。这种方式与静态 script 标签同源，双击打开 `index.html` 仍可工作，不受浏览器 `fetch` 本地文件限制。

未传 `day` 参数时渲染首页：读取 `manifest.js` 与本地进度，展示学习日导航网格；某天若 `ready` 为 `false`，点击不可用，直接提示"开发中"。

## 状态保存

使用 `localStorage`，键名以 `chemlab-g9:v3:` 开头，且仅保存与身份无关的学习数据：

| 键 | 内容 |
| --- | --- |
| `chemlab-g9:v3:day-XX` | 该天的作答、得分、完成时间 |
| `chemlab-g9:v3:review` | 跨天错题复习队列（题干与所属天数），提交某天测验时会先移除该天旧记录再写入最新结果 |

不保存姓名、账号等个人身份信息。

## iPad 设计基线

- 最小触控目标：44 × 44 CSS px。
- 内容最大宽度：920px，正文行长控制在易读范围。
- 不依赖 hover；系统减少动态效果时关闭非必要过渡。
- 使用系统中文字体栈，默认文字大小不小于 16px。
