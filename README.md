# ChemLab-G9

面向九年级化学（人教版上册）的 30 天自学 iPad 单页学习系统。

## 在线学习

https://momo2015-ai.github.io/ChemLab-G9/

## iPad 离线使用

将 `dist/ChemLab-G9.html` 发送到 iPad，通过 Safari 打开即可离线学习。

- 无需安装、无需服务器、无需登录
- 支持本地学习记录持久化

## 功能一览

- 30 天完整课程（Day01-Day30），覆盖人教版九年级化学上册全部章节
- 8 大交互实验图：气密性检查、红磷燃烧、氧气助燃、高锰酸钾制氧、电解水、水的净化、质量守恒、CO₂ 制取
- 5 大知识互动图：原子结构模型、元素周期表、分子运动三态、碳同素异形体、离子形成过程
- 每日练习题（含情境自测），跨天错题复习（按知识点筛选 + 间隔到期）
- 学习进度统计、单课笔记、30 天关键词搜索
- 学习数据一键导出 / 导入备份
- 成就激励系统
- 触摸友好交互：科学探究排序（拖拽 / 按钮 / 键盘）、控制变量练习、方程式拼写与配平
- 科学正确性脚本巡检 + 发布门禁
- iPad 适配 + 单文件离线构建

## 课程规划

| 模块 | 天数 | 主题 |
|------|------|------|
| 一 | Day01-03 | 开启化学之门 |
| 二 | Day04-08 | 我们周围的空气 |
| 三 | Day09-15 | 物质构成的奥秘 |
| 四 | Day16-18 | 自然界的水 |
| 五 | Day19-23 | 化学方程式 |
| 六 | Day24-27 | 碳和碳的氧化物 |
| 七 | Day28-29 | 燃料及其利用 |
| 八 | Day30 | 综合提升 |

## 项目结构

```
src/js/app.js    # 主程序（界面、交互、SVG 配图、搜索、备份、激励）
src/css/app.css  # 样式
dist/            # 离线单文件版本（ChemLab-G9.html）
scripts/         # 构建、内容校验与科学正确性巡检工具
tests/           # 冒烟测试
```

## 发布门禁

```
node scripts/validate-content.mjs && node scripts/check-science.mjs --fatal && node scripts/build-single.mjs && node tests/smoke.mjs
```

## License

MIT License

Copyright (c) 2026 Momo2015-AI

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
