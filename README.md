# ChemLab-G9 V1.0

面向九年级化学（人教版上册）的 30 天自学 iPad 单页学习系统。

## 当前版本

V1.0：完成基础学习系统框架，包括课程导航、学习页面、练习测试、本地学习记录、错题复习、进度展示和离线单文件版本。

## 在线学习

GitHub Pages 地址：

https://momo2015-ai.github.io/ChemLab-G9/

## iPad 离线使用

将 `dist/ChemLab-G9.html` 发送到 iPad，通过 Safari 打开即可离线学习。

特点：

- 无需安装
- 无需服务器
- 无需登录
- 支持本地学习记录

- 30 天课程导航框架 + 学习页「上一课 / 下一课」流转
- 学习日页面
- 化学知识讲解（关键结论 / 提示高亮块）
- 每日练习题
- 跨天错题复习（支持按知识点筛选 + 简单间隔到期）
- 学习进度统计（区分「已读完」与「已答完」）
- 单课笔记（本地保存）
- 30 天跨天关键词搜索
- 学习数据一键导出 / 导入备份
- 成就激励系统
- 触摸友好交互：科学探究排序（拖拽 / ↑↓ 按钮 / 键盘）、控制变量练习
- 实验必须时可标「需成人陪同」；科学正确性脚本巡检
- iPad 适配 + 单文件离线构建

## 课程规划

- Day01-Day03：开启化学之门
- Day04-Day08：我们周围的空气
- Day09-Day15：物质构成的奥秘
- Day16-Day18：自然界的水
- Day19-Day23：化学方程式
- Day24-Day27：碳和碳的氧化物
- Day28-Day29：燃料及其利用
- Day30：综合提升

## 项目结构

- `src/`：程序代码（界面、交互、SVG 配图、搜索、备份、激励）
- `content/`：课程内容
- `quiz/`：练习题
- `dist/`：离线单文件版本
- `scripts/`：构建、内容校验与科学正确性巡检工具
- `docs/`：设计文档

## 发布门禁

开发一套一次跑通：

```
node scripts/validate-content.mjs && node scripts/check-science.mjs --fatal && node scripts/build-single.mjs && node tests/smoke.mjs
```

- `validate-content.mjs`：内容 / 题目数据结构一致性
- `check-science.mjs`：高频考点与易错表述巡检 + 安全边界抽查（`--fatal` 将有错误阻断发布）
- `build-single.mjs`：内联出 `dist/ChemLab-G9.html`
- `tests/smoke.mjs`：对构建产物做 DOM 冒烟测试

## 后续计划

1. 完善 Day01-Day30 全部精品课程内容
2. 增加 AI 化学辅导能力
3. 增加实验模拟与互动学习
4. 优化移动端体验
