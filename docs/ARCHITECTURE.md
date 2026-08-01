# ChemLab-G9 V3.0 架构规范

## 技术原则

- 单页、静态、离线优先：入口为根目录 `index.html`。
- 原生 HTML / CSS / JavaScript，不引入框架、打包器或外部 CDN。
- 内容与界面分离：课程内容放在 `content/`，题目放在 `quiz/`，渲染逻辑放在 `src/`。
- 以语义化标签和可访问性优先；所有互动均需有非动画的文字信息。

## 代码职责

| 路径 | 职责 |
| --- | --- |
| `index.html` | 页面外壳、无脚本提示、模块加载顺序 |
| `src/css/app.css` | 色彩令牌、排版、响应式和组件样式 |
| `src/js/app.js` | 状态、渲染、导航、练习与本地保存 |
| `content/days/day-XX.js` | 某天的教学内容对象 |
| `quiz/day-XX.js` | 某天的题目对象 |
| `assets/` | 经审核可用的本地媒体资源 |

## 内容加载约定

课程和题目文件以 `window.ChemLabContent` 与 `window.ChemLabQuiz` 注册。入口页面按需通过 script 标签顺序加载，因此双击打开 `index.html` 也可工作，不受浏览器 `fetch` 本地文件限制。

## 状态保存

使用 `localStorage`，键名以 `chemlab-g9:v3:` 开头。仅保存：完成状态、已选答案、得分和最后学习日期；不保存个人身份信息。

## iPad 设计基线

- 最小触控目标：44 × 44 CSS px。
- 内容最大宽度：920px，正文行长控制在易读范围。
- 不依赖 hover；系统减少动态效果时关闭非必要过渡。
- 使用系统中文字体栈，默认文字大小不小于 16px。
