# 嘴替 / Clapback

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Chrome MV3](https://img.shields.io/badge/Chrome-MV3-green)](https://developer.chrome.com/docs/extensions/mv3/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)](https://www.typescriptlang.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-orange)](https://github.com/anomalyco/bome/pulls)

**找到一条评论，按你的意图生成几条可复制、可填入的回复候选。**  
不替你自动发布，不接管账号，不假装 AI。

适用于知乎、微博、小红书评论区。

---

## 快速开始

```bash
npm install
npm run build:extension
```

然后在 Chrome / Edge 扩展管理页加载 `apps/extension/dist/`。

常用命令：

| 命令 | 说明 |
| --- | --- |
| `npm run dev:extension` | Workbench UI 开发服务器 |
| `npm run build:extension` | TypeScript 检查 + 生产构建 |
| `npm run test:extension` | 运行 extension 测试 |
| `npm test` | 运行全部测试 |

---

## 使用流程

1. 在评论区找到想回复的内容，点原生操作行末尾的 **嘴替**。
2. 选择风格 Skill，写下你的意图。
3. 选长度，点生成，3 条候选到手。
4. 单击复制，双击填入回复框。

---

## 内置 Skill

| Skill | 名称 | 一句话 |
| --- | --- | --- |
| `full_fire` | 焚锋 | 火力拉满，直接羞辱、贴标签、反问压脸。 |
| `restrained_breakdown` | 静辨 | 拆前提、拆偷换、拆模糊词，赢得更稳。 |
| `sarcastic_ironic` | 冷讥 | 假装顺着说，把对方逻辑推到荒谬。 |
| `wenyan_attack` | 文言 | 半文半白，像写判词一样收刀。 |

内置 Skill 只是默认武器。你可以在 Workbench 里导入或创建自己的 Skill。

---

## Workbench

扩展的管理界面，用来配置模型和管理材料。

- **设置** — 模型厂商、Base URL、API Key、语言、主题
- **素材箱** — 手动导入、上传、从创作者页面采风
- **技能工坊** — 选素材箱，写创作目标，生成 Skill 草稿，试打，反馈重建，发布
- **技能库** — Skill 文档、样例、风险提示和评分
- **弹药箱** — 短参考材料，生成时可按需选择

---

## 技术边界

| 方面 | 说明 |
| --- | --- |
| 架构 | Chrome MV3 扩展，`apps/extension/dist/` 可加载 |
| 内容脚本 | 原生 DOM，不引入 React |
| Workbench | React 19 + TypeScript + Vite |
| 通信 | `chrome.runtime.sendMessage` → background service worker |
| 存储数据 | IndexedDB（业务）、`chrome.storage.local`（设置） |
| API Key | 遮蔽展示，不会出现在普通列表或读取返回里 |
| Skill | 声明式包，导入时拒绝 `.js`/`.py`/`.exe` |

---

## 目录结构

```text
apps/extension/
├── public/manifest.json      # MV3 清单
├── src/
│   ├── background.ts         # Service Worker：消息与模型调用
│   ├── api/                  # 存储、模型连接、生成流水线
│   ├── content/              # 知乎/微博/小红书内容脚本
│   └── workbench/            # React Workbench
└── vite.config.ts            # Workbench 构建入口
```


## Star History

[![Star History](https://api.star-history.com/svg?repos=anomalyco/bome&type=Date)](https://star-history.com/#anomalyco/bome&Date)

---

## 致谢

感谢 [Linux Do](https://linux.do/) 社区。这个项目从社区的讨论和反馈中受益良多。

---

## 许可

[GNU Affero General Public License v3.0](https://www.gnu.org/licenses/agpl-3.0.html)
