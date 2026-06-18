# 嘴替 / Clapback

嘴替是一个本地优先的浏览器扩展，给知乎、微博、小红书等评论区加一个真正可用的反击按钮。它不替你自动发布，不接管账号，只做一件事：锁定一条评论或回答，按你的意图生成几条可复制、可编辑、可填入的回复候选。

## 现在能做什么

- 在真实评论区动作栏末尾插入 `嘴替` 按钮。
- 点击后打开轻量面板，自动锁定目标文本和页面上下文。
- 选择 Skill，填写想表达的意图，选择短/中/长或自定义字数。
- 生成 3 条候选回复，单击复制，双击填入回复框。
- 永不自动发布，最后一句话仍然由用户决定。

长自定义评论现在走 Agent Pipeline：先完整读取当前 Skill，生成本轮任务计划，再并行生成多个角度，最后只在必要时做修复或补位。这个流程主要是为真实知乎场景准备的，目标是让 OpenCode Go `deepseek-v4-flash` 稳定给出来自模型正文 `content` 的 3 条候选，而不是靠本地模板假装成功。

## 四个内置 Skill

嘴替默认带 4 个风格完全不同的 Skill。它们不是几个提示词按钮，而是可被完整读取的 Skill 包，生成时会影响角度、语气、句式和收尾方式。

| Skill ID | 名称 | 适合什么场景 |
| --- | --- | --- |
| `full_fire` | 焚锋 | 火力拉满，直接羞辱、贴标签、反问压脸。适合用户明确想要强攻击性的回复。 |
| `restrained_breakdown` | 静辨 | 不吵不骂，拆前提、拆偷换、拆模糊词。适合想赢得更稳、更像认真反驳的场景。 |
| `sarcastic_ironic` | 冷讥 | 假装顺着对方说，把对方逻辑推到荒谬。适合反讽、冷笑话、荒谬化还击。 |
| `wenyan_attack` | 文言 | 半文半白，像写判词一样收刀。适合想要文雅但扎人的回复。 |

用户也可以在 Workbench 里导入或创建自己的 Skill。内置 Skill 只是默认武器，不是上限。

## 典型使用流程

1. 在知乎、微博或小红书页面找到想回复的内容。
2. 点原生操作行里的 `嘴替`。
3. 在面板里选择 Skill，写下本次意图，比如"反驳对方把复杂伤害简化成作息问题"。
4. 选择长度，或填一个自定义目标字数。
5. 点击生成，挑一条复制或双击填入。

如果没有选择弹药箱，正式评论生成不会默认读取弹药箱内容。弹药箱只在用户显式勾选时参与生成。

## Workbench

Workbench 是扩展的管理界面，主要用来配置模型和管理材料。

- 设置：模型厂商、Base URL、API Key、语言、主题、试打轮次。
- 素材箱：手动导入、上传、从创作者页面采风。
- 技能工坊：选素材箱，写创作目标，生成 Skill 草稿，试打，反馈重建，发布。
- 技能库：查看 Skill 文档、样例、风险提示和评分。
- 弹药箱：管理短参考材料，生成时可按需选择。

## 评论生成流程

对 OpenCode Go `deepseek-v4-flash` 的长自定义评论，生成流程已经从一次性 prompt 改成分阶段流水线：

```text
Skill Activation -> Confirmation -> Parallel Execute -> Refine/Repair
```

这几个阶段各自负责不同的事：

- Skill Activation：每轮完整读取当前 Skill，结合目标评论、用户意图和长度目标，生成本轮任务计划。
- Confirmation：本地检查计划是否有足够角度、是否真的读懂目标和 Skill。
- Parallel Execute：并行跑 3 个不同角度，尽快拿到 3 条候选。
- Refine/Repair：只有在缺候选、空 content、长度截断、明显过长或过短时才补救。

流水线不会把 `finish_reason=length`、空 `content`、reasoning-only 输出当成成功，也不会用本地 fallback 冒充模型结果。100 字目标下，完整的 116、120、125 字评论会被接受，不会硬裁剪成半句话。

## 技术边界

- Chrome MV3 扩展，`apps/extension/dist/` 是可加载目录。
- 内容脚本使用原生 DOM，不引入 React。
- Workbench 使用 React 19、TypeScript 和 Vite。
- 内容脚本和 Workbench 通过 `chrome.runtime.sendMessage` 与 background service worker 通信。
- 业务数据存在 IndexedDB，轻量设置存在 `chrome.storage.local`。
- API Key 不会出现在普通列表或读取返回里，只做遮蔽展示。
- Skill 是声明式包，导入编译时拒绝 `.js`、`.py`、`.exe` 等可执行文件。

## 快速开始

```bash
npm install
npm run build:extension
```

然后在 Chrome 或 Edge 的扩展管理页加载 `apps/extension/dist/`。

开发和验证常用命令：

| 命令 | 说明 |
| --- | --- |
| `npm test` | 运行扩展测试 |
| `npm run test:extension` | 运行 extension workspace 测试 |
| `npm run build:extension` | TypeScript 检查和生产构建 |
| `npm run dev:extension` | Workbench UI 开发服务器 |

## 目录结构

```text
apps/extension/
├── public/manifest.json      # MV3 清单
├── src/
│   ├── background.ts         # Service Worker，处理消息与模型调用
│   ├── api/                  # 存储、模型连接、生成流水线
│   ├── content/              # 知乎/微博/小红书内容脚本
│   └── workbench/            # React Workbench
└── vite.config.ts            # Workbench 构建入口
```

## 设计取向

嘴替的界面不是仪表盘，也不是聊天窗口。评论区面板要轻，像一张贴在页面边上的浮签；Workbench 可以更完整，但仍然是工具，不是展示页。

视觉关键词：宣纸浮签、印章红、墨色层级、留白、工具感。

## 许可

[GNU Affero General Public License v3.0](https://www.gnu.org/licenses/agpl-3.0.html)

## 开发约定

- 内容脚本只能使用原生 DOM 操作。
- 重复注入不能产生重复按钮。
- 触发器插在原生操作行末尾，文案统一为 `嘴替`。
- 生成面板固定右下角，移动端使用底部抽屉。
- 技能必须是声明式包，不可包含可执行文件。
- 按钮最小触控区域 44px，卡片圆角 8px。
- 遵守 `prefers-reduced-motion`。
