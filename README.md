# 嘴替 / Clapback

中文社区评论区智能回复助手 —— 一个本地优先的 Chrome MV3 浏览器扩展。

## 这是什么

嘴替是一个浏览器扩展，在知乎、微博、小红书等评论区识别目标评论，生成犀利回复候选。它不是通用聊天机器人，而是一个**评论区代理**：锁定目标评论 → 表达意图 → 选择技能 → 生成候选 → 复制或填入，永不自动发布。

核心产品循环：

```
素材箱 + 创作目标 → 技能工坊 → 草稿技能 → 试打 → 反馈重建(最多3轮) → 发布技能
主动技能 + 弹药箱 + 目标评论 + 意图 + 约束 → 候选回复
```

## 功能模块

### 评论区生成面板（宣纸浮签）

- 在目标评论旁注入 `🤬` 入口按钮
- 锁定目标评论文本，抽取页面上下文
- 轻量浮签面板：输入表达意图 → 生成候选
- 单击复制，双击填入回复框
- 永不自动发布

### 工作台（Workbench）

- **设置**：模型厂商、Base URL、API Key、语言、主题、试打轮次
- **素材箱**：手动导入、上传、创作者页面采风导入
- **技能工坊**：选择素材箱 → 设定创作目标 → 生成技能草稿 → 试打 → 反馈 → 发布
- **技能库**：查看技能文档、风险提示、评分、样例
- **弹药箱**：管理短参考材料，生成时可多选

## 技术架构

```
apps/extension/
├── public/manifest.json      # MV3 清单
├── src/
│   ├── background.ts         # Service Worker，处理消息与模型调用
│   ├── content/              # 纯 DOM 内容脚本（不使用 React）
│   │   ├── main.ts           # 入口：调用平台适配器
│   │   ├── zhihuAdapter.ts   # 知乎评论识别与按钮注入
│   │   ├── weiboAdapter.ts   # 微博适配
│   │   ├── xhsAdapter.ts     # 小红书适配
│   │   └── runtimeClient.ts  # 通过 chrome.runtime.sendMessage 调后台
│   └── workbench/            # React 19 工作台（popup/选项页）
│       ├── App.tsx           # 模块标签：设置、素材箱、技能工坊、技能库
│       ├── main.tsx          # createRoot 入口
│       └── styles.css        # CSS 变量与水墨设计 token
└── vite.config.ts            # 多入口：index.html + content script
```

**关键边界：**
- 内容脚本是纯 DOM/TypeScript，不引入 React 或任何框架
- Workbench 和内容脚本通过 `chrome.runtime.sendMessage` 调用 Background Service Worker
- 业务数据存 IndexedDB，轻量设置存 `chrome.storage.local`
- API Key 不出现在普通列表/读取返回中，仅遮蔽展示
- 技能是声明式包，导入编译时拒绝 `.js/.py/.exe` 等可执行文件
- 生成永不自动发布

## 设计语言

现代中文水墨风格，关键词：**宣纸浮签、印章红、墨色层级、留白、工具感**。

| 角色 | 色值 |
|------|------|
| 焦墨 | `#1a1a1a` |
| 浓墨 | `#333333` |
| 淡墨 | `#666666` |
| 清墨 | `#999999` |
| 宣纸白 | `#F8F5F0` |
| 暖米色 | `#FAF0E6` |
| 象牙白 | `#FFFFF0` |
| 印章红 | `#C41E3A` |
| 山青 | `#2E8B57` |
| 金点缀 | `#D4AF37` |

字体：刘建毛草（展示标题）、ZCOOL 小薇（正文）、Noto Serif SC（辅助文本）。

生成面板必须轻量，不做仪表盘。工作台允许更多纸面氛围，但仍是操作工具而非装饰页面。

## 快速开始

```bash
# 安装依赖
npm install

# 构建扩展（TypeScript 检查 + Vite 构建 → apps/extension/dist/）
npm run build:extension

# 开发模式（Workbench UI 热更新）
npm run dev:extension

# 运行测试
npm test
```

构建后在 Chrome 中加载 `apps/extension/dist/` 目录即可使用。

## 命令参考

| 命令 | 说明 |
|------|------|
| `npm test` | 运行扩展测试（Vitest + jsdom） |
| `npm run test:extension` | 同上 |
| `npm run build:extension` | TypeScript 检查 + 生产构建 |
| `npm run dev:extension` | Vite 开发服务器 |
| `npm run legacy:dev:runtime` | （仅旧版参考）FastAPI 开发服务器 |
| `npm run legacy:test:runtime` | （仅旧版参考）Python 测试套件 |

## 技术栈

- **运行时**：Chrome MV3 Extension API
- **前端**：React 19 + TypeScript + Vite
- **样式**：手写 CSS 变量，水墨设计 token 体系
- **存储**：IndexedDB（业务数据）+ `chrome.storage.local`（设置）
- **图标**：Lucide React（Workbench 内）
- **测试**：Vitest + jsdom + @testing-library/react
- **Node**：>= 20

## 许可

[GNU Affero General Public License v3.0](https://www.gnu.org/licenses/agpl-3.0.html)

MediaCrawler 衍生代码保留其非商业许可声明。

## 开发约定

- 扩展内容脚本不能引入 React 或任何框架 —— 只能使用原生 DOM 操作
- 内容脚本和 Workbench 统一通过 `chrome.runtime.sendMessage` 与 Background 通信
- 重复注入不能产生重复按钮，触发器插在原生操作行末尾
- 生成面板固定右下角（移动端底部抽屉），目标文本需清洗
- 技能必须是声明式包，不可包含可执行文件
- 按钮最小触控区域 44px，卡片圆角 8px
- 遵守 `prefers-reduced-motion`
