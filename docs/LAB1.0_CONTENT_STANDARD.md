# ChemLab-G9 LAB1.0 内容开发标准

## 目标

将课程从知识展示系统升级为九年级化学自主学习教练系统。

## 单日课程结构

每一天课程必须包含：

1. 学习目标
2. 真实化学现象
3. 核心概念
4. 微观解释
5. 生活应用
6. 实验探究
7. 中考易错点
8. 典型题训练
9. 学习总结

## 知识点模型

```javascript
{
  concept: "",
  phenomenon: "",
  explanation: "",
  application: "",
  examPoint: ""
}
```

## 实验模型

```javascript
{
  question: "",
  hypothesis: "",
  procedure: [],
  observation: "",
  conclusion: "",
  errorAnalysis: ""
}
```

## 题目模型

```javascript
{
  question: "",
  answer: "",
  explanation: "",
  difficulty: "",
  errorType: "",
  examPoint: ""
}
```

## 内容质量要求

避免单纯记忆，所有核心知识必须回答：

- 看到了什么？
- 为什么？
- 如何应用？
- 中考如何考？
