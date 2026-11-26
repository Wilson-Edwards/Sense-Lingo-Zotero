# Sense Lingo

**简体中文** | [English](README.md)

> **Zotero 7 里的语境感知 AI 划词翻译。** 划一个词，结合它所在的句子辨析词义，并给出美式 / 英式音标；
> 划一整句，直接给出通顺译文。**两套提示词各管一件事，互不干扰。**

<p>
  <img alt="Zotero 7" src="https://img.shields.io/badge/Zotero-7-CC2936?style=flat-square&logo=zotero" />
  <img alt="Version 0.1.0" src="https://img.shields.io/badge/version-0.1.0-blue?style=flat-square" />
  <img alt="License AGPL-3.0" src="https://img.shields.io/badge/license-AGPL--3.0-blue?style=flat-square" />
  <img alt="Tests 168 passing" src="https://img.shields.io/badge/tests-168%20passing-brightgreen?style=flat-square" />
</p>

<!-- 发布前建议补一张演示 GIF：放到 docs/images/demo.gif，然后在这里插入
<img src="docs/images/demo.gif" width="720" alt="划词翻译演示" /> -->

[快速开始](#快速开始) · [使用](#使用) · [配置](docs/configuration.md) · [提示词](docs/prompts.md) · [工作原理](docs/how-it-works.md) · [开发](docs/development.md) · [排错](docs/troubleshooting.md)

## 为什么需要它

读英文文献时，**只翻译一个单词往往还是读不懂**：

| 常见做法             | 问题                                                                                               |
| -------------------- | -------------------------------------------------------------------------------------------------- |
| 只把选中的词交给翻译 | 丢掉了它所在的句子。`address` 在 `address the issue` 里是「处理」，在 `email address` 里是「地址」 |
| 直接翻译整段         | 又太重，而我只想知道这一个词在这句话里的意思和用法                                                 |
| 通用划词工具         | 把选区当全部输入，译文经常「对但不对味」                                                           |

所以本项目只做一件事：**划词 → 自动抓取该词所在的句子 → 连同句子一起交给大模型 →
得到有语境、可自定义提示词的译文。**

一句话定位：**Zotero 里最懂语境的 AI 划词翻译插件。**

## 效果示例

以 `The results suggest that the proposed method can mitigate the inherent noise.` 为例，
同一句话两种划法：

| 划选内容                            | 判定 | 输出                                                                                                    |
| ----------------------------------- | ---- | ------------------------------------------------------------------------------------------------------- |
| `mitigate`                          | 词   | 减轻（v.）；在此句中指降低…的程度<br>`美式音标：/ˈmɪtɪɡeɪt/`<br>`英式音标：/ˈmɪtɪɡeɪt/`                 |
| `inherent`                          | 词   | 固有的（adj.）；句中修饰 noise，指数据自带的噪声<br>`美式音标：/ɪnˈhɛrənt/`<br>`英式音标：/ɪnˈhɪərənt/` |
| `The results suggest that … noise.` | 句   | 结果表明，所提方法能够减轻固有噪声。                                                                    |

关键差别：**划词时模型解释「它在这个句子里是什么意思」，划句时只给译文、不做解释。**
这就是把提示词按选区类型分开的意义——同一套模板无法同时把两件事做好。

## 核心特性

| 能力               | 说明                                                                                                                                                       |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🔤 划词 / 划句翻译 | 在 Zotero 阅读器（PDF / EPUB）中选中文本，译文直接显示在原生划词弹窗内，只显示译文                                                                         |
| 🧩 语境消歧        | 划词时自动带出所在句；划句时可选带出前后各一句，避免重复与复读                                                                                             |
| 🗣 美 / 英音标      | 划词固定三行：**释义** / **美式音标** / **英式音标**，人名、地名、品牌 / 产品名等专有名词同样适用                                                          |
| 🎯 双提示词路由    | 「划词」与「划句」两套独立模板：前者给语境词义 + 词性，后者给通顺译文，互不干扰                                                                            |
| 🤖 多服务商        | 内置 **OpenAI** / **DeepSeek** / **ClinePass** / **Command Code**，并提供「OpenAI 兼容」模式覆盖任意自建 / 第三方网关（含 Ollama）                         |
| ✍️ 提示词完全可改  | 每种选区类型可保存多套模板，设置页增删改、下拉切换当前使用；结果面板还能临时换一套重译。换行原样保留，支持 `{text}` / `{sentence}` / `{targetLang}` 等变量 |
| 🎛️ 模型参数可配    | 模型下拉选择 + 自定义输入、`baseURL`、`temperature`、`max_tokens`、超时全部可调，切换服务商互不覆盖；整本预翻译可单独选择服务商与 Key                      |
| 🚫 禁止思考        | 默认开启：请求带 `reasoning: { enabled: false }`，跳过推理阶段（Qwen / Kimi 实测思考 token 归零，显著更快更省）；服务商强制推理时自动重试                  |
| ⚡ 快捷键结果面板  | `Ctrl/⌘ + Shift + T`：判定类型、模板名、命中原句、模型 · 耗时，可一键切换类型重译、临时改 user 消息、复制                                                  |
| 🪄 自动翻译        | 选中文本即出译文，无需点击；默认关闭，避免误触发与额外费用                                                                                                 |
| 🌊 流式输出        | 默认开启，译文边生成边显示；可关闭，服务商不支持流式时自动回退，超时按空闲时间计算                                                                         |
| 🔁 类型可纠正      | 自动判定失误时，面板一键在「词 / 句」间切换并立即重译，只影响本次                                                                                          |
| 🌐 中英双语界面    | 文案通过 Fluent 本地化，内置 `zh-CN` / `en-US`                                                                                                             |

## 快速开始

### 1. 安装插件

**从 Release 安装**（发布后可用）：

1. 从 [Releases](https://github.com/linqingxiao/sense-lingo-zotero/releases) 下载 `sense-lingo.xpi`；
2. Zotero → `工具 / Tools` → `插件 / Plugins` → 右上角齿轮 → `Install Plugin From File…`；
3. 选择 xpi，重启 Zotero。

**从源码构建**（当前版本推荐）：

```bash
npm install
npm run build        # 产物：.scaffold/build/sense-lingo.xpi
```

然后在同一入口安装该 xpi。需要 **Zotero 7.0 ~ 11.x**
（见 `addon/manifest.json` 的 `strict_min_version` / `strict_max_version`）。

> 装不上、提示不兼容？多半是 `strict_max_version` 低于当前 Zotero 版本，
> 见 [排错：Zotero 升级后装不上](docs/troubleshooting.md#zotero-升级后装不上)。

### 2. 填写 API Key

打开 `编辑 / Edit` → `设置 / Settings` → `Sense Lingo`：

| 字段           | 填什么                                                                              |
| -------------- | ----------------------------------------------------------------------------------- |
| 服务商预设     | `OpenAI` / `DeepSeek` / `ClinePass` / `Command Code` / `Custom (OpenAI compatible)` |
| API Key        | 对应服务商的 Key（必填）                                                            |
| 接口地址、模型 | 留空即用预设，也可自行填写                                                          |

| provider      | 默认接口地址                             | 默认模型                         |
| ------------- | ---------------------------------------- | -------------------------------- |
| `openai`      | `https://api.openai.com/v1`              | `gpt-4o-mini`                    |
| `deepseek`    | `https://api.deepseek.com/v1`            | `deepseek-chat`                  |
| `clinepass`   | `https://api.cline.bot/api/v1`           | `cline-pass/deepseek-v4.1-flash` |
| `commandcode` | `https://api.commandcode.ai/provider/v1` | `deepseek/deepseek-v4-flash-fast` |

每个服务商的 Key / 地址 / 模型会**分别保存**，来回切换不会互相覆盖。
用本地模型请选 `Custom`，把接口地址指向本地 OpenAI 兼容端点。

模型框是一个**下拉列表**，打开设置页就会填好当前服务商的模型，选一项即可：
ClinePass 直接列出预设里那 10 个实测可用的 slug（打开即可选，无需先点按钮），
第一项「使用预设」等价于把 `model` 留空；下拉里没有的模型写在 **自定义模型** 里。
点 **获取模型** 只是刷新一次：ClinePass 没有自己的模型列表接口
（`/api/v1/cline-pass/models` 为 404），共享的 `/api/v1/models` 里也不含
`cline-pass/...` 别名，所以刷新后仍回落到预设清单。选中 ClinePass 后，请求会自动带上
`X-Response-Format: openai` 请求头。
Command Code 的 `GET /models` 会返回 `provider/model` 目录，点 **获取模型** 即可把当前 Key
走 chat 接口能用的模型填进下拉（只能走 `/messages` 的 `claude-*` 会被过滤掉）。

### 3. 开始使用

1. 打开任意 PDF / EPUB 附件；
2. 选中文本——**选一个词**或**选一整句**都可以，插件自动判定类型；
3. 点击弹窗里的 **翻译**，译文会直接出现在弹窗内；
   开启「自动翻译」后，选中文本即出译文，无需点击。

首次使用未配置 Key 时，点击翻译会提示前往设置页填写。

## 使用

### 划词弹窗

- 选中文本后，弹窗里出现 **翻译** 按钮；点一下，译文直接渲染在弹窗内，**只显示译文**，不占用右下角。
- 划词固定三行：**释义（含词性）**、**美式音标**、**英式音标**，人名、地名、品牌名同样适用。
  模型偶尔把标签粘在一行，展示前会自动拆行。
- 设置里打开 **自动翻译** 后，选中即出译文，按钮自动隐藏；未配置 API Key 时静默跳过，
  不会每次划词都弹错误。
- 弹窗字号可调（8–32 px），弹窗宽度随字号等比放宽，保持每行字数基本不变。
- 译文是**内联**的：请求返回前关掉弹窗，结果就没有地方显示。需要保留时用快捷键打开面板。

### 快捷键与结果面板

按 `Ctrl/⌘ + Shift + T` 打开完整结果面板，信息比弹窗多：

| 区域 | 内容                                                                   |
| ---- | ---------------------------------------------------------------------- |
| 顶部 | 本次判定类型（词 / 句）、使用的模板名                                  |
| 正文 | 译文；划词模式下再显示命中的原句（取不到时提示「未取到上下文」）       |
| 底部 | `模型 · 耗时`，以及「按句重译 / 按词重译」「改提示词」「复制」「关闭」 |

- 判定不符合预期时，一键在「词 / 句」间切换并立即重译——只影响本次，不写回设置。
- 「改提示词」编辑的是**这一次请求的 user 消息**（变量已渲染），只对本次生效；
  想长期修改请改设置页的 system 模板。
- 阅读器里的快捷键在**首次划词弹窗渲染时**绑定到该文档：打开新文献后先划一次词，之后快捷键即可用。
- 主窗口里也能按快捷键，但拿不到附件与上下文，只做纯词义翻译。

## 常用配置

设置入口：`编辑 / Edit` → `设置 / Settings` → `Sense Lingo`。
完整 25 项、服务商隔离机制与 `about:config` 改法见 **[配置项参考](docs/configuration.md)**。

| 设置              | 默认       | 作用                                                           |
| ----------------- | ---------- | -------------------------------------------------------------- |
| 服务商预设        | `openai`   | `openai` / `deepseek` / `clinepass` / `commandcode` / `custom` |
| API Key           | 空         | 必填，以明文保存在 Zotero prefs                                |
| 接口地址 / 模型   | 空         | 留空即用预设；只写主机名会自动补 `/v1`                         |
| 温度              | `0.3`      | 越低越稳定，翻译建议 0～0.5                                    |
| 最大 tokens       | `1024`     | 单次回复上限                                                   |
| 判定方式          | `auto`     | `auto` / `alwaysWord` / `alwaysSentence`                       |
| 最大词数 / 字符数 | `3` / `40` | 超过则按「句」处理                                             |
| 划词带出所在句    | 开         | 关闭后等同词典式直译                                           |
| 划句带出前后句    | 关         | 开启后会多带前后各一句，token 增加                             |
| 单句上下文上限    | `400`      | 超出截断并在面板提示                                           |
| 弹窗按钮          | 开         | 是否在划词弹窗注入「翻译」按钮                                 |
| 自动翻译          | 关         | 选中即翻译，按钮隐藏                                           |
| 快捷键            | 开         | `Ctrl/⌘ + Shift + T`                                           |
| 弹窗字号          | `12`       | 8–32 px                                                        |
| 请求超时          | `30000`    | 毫秒；超时提示重试                                             |
| 流式输出          | 开         | 默认开启；边生成边显示，超时按空闲时间计算                     |
| 调试日志          | 关         | 输出到 `帮助 → 调试输出`                                       |

> 目标语言 `targetLang` 默认 `zh-CN`，目前未出现在设置页，可在 `about:config` 里修改
> `extensions.zotero.sense-lingo.targetLang`。

## 提示词自定义

设置页的 **提示词模板** 区域分成「划词模板」和「划句模板」两组，每组都能保存多套提示词：

| 控件        | 作用                                                            |
| ----------- | --------------------------------------------------------------- |
| 下拉框      | 选择这一类型**当前使用**的模板（立刻写入 pref，下次翻译即生效） |
| 新建 / 复制 | 从内置模板新建，或复制当前模板（副本）                          |
| 删除        | 删除自定义模板；内置模板受保护，只能改写                        |
| 名称        | 模板名，会显示在结果面板顶部与模板下拉框里                      |
| 多行文本框  | 发给模型的 **system** 提示词，直接编辑即可，**换行原样保留**    |

- 每组内置模板是兜底项：删不掉、可改写，清空文本框会恢复内置内容。
- 划词与划句完全独立：只改划词模板，划句行为完全不变，反之亦然。
- 划选的文本与上下文由插件自动附在 user 消息里，模板中不必再写一遍。
- 快捷键结果面板的模板下拉框可以在**本次**换用同类型的其它模板并立即重译，不会改动默认设置。

常用变量：

| 变量              | 含义           | `word` 模式     | `sentence` 模式              |
| ----------------- | -------------- | --------------- | ---------------------------- |
| `{text}`          | 划选的原始文本 | 选中的词 / 短语 | 选中的整句 / 整段            |
| `{sentence}`      | 上下文句子     | 所在完整句子    | 空串（避免与 `{text}` 重复） |
| `{prevSentence}`  | 前一句         | 空串            | 仅开启「带出前后句」时有值   |
| `{nextSentence}`  | 后一句         | 空串            | 同上                         |
| `{selectionType}` | 本次判定结果   | `word`          | `sentence`                   |
| `{targetLang}`    | 目标语言       | 原样取自 pref   | 同左                         |

> 变量只做纯文本替换，不执行表达式；未识别的 `{xxx}` 原样保留，不会误伤 LaTeX。

**内置默认模板、完整变量表、现成示例（术语速查 / 直译 / 只要中文）** 见
**[提示词自定义](docs/prompts.md)**。

## 工作原理（简版）

```text
划选文本（词 / 句）
      │
      ▼
判定选区类型  word ──► 取「所在句」作上下文
              sentence ──► 不使用 {sentence}，可选前后句
      │
      ▼
按类型选提示词模板 → 渲染变量 → POST {baseURL}/chat/completions
      │
      ▼
弹窗内联译文（只显示译文）／ 结果面板（类型、模板、原句、模型 · 耗时）
```

几个关键设计：

- **类型判定**是可解释的启发式：单 ASCII 词不因句末标点判句；词数 > 3、字符数 > 40、
  中文字符 ≥ 8 判为句；单独的换行不作为判据。
- **句子定位**不依赖 PDF 坐标，而是三层文本来源（附件全文缓存 → 阅读器实时文档
  → EPUB 解析）+ 文本匹配；同一个词出现多次时，用划词瞬间抓取的左右各 40 字符**指纹**
  选最像的那一处。
- **提示词路由**只有一行：`kind` 决定读哪个模板 id，id 失效时先回退同类型模板、再回退内置模板并告警。
- **一家客户端覆盖多家服务商**：OpenAI / DeepSeek 都走 OpenAI 兼容协议，
  差异只是 `baseURL` + `model` 预设。

完整链路、匹配算法、错误码、缓存与设计取舍见 **[工作原理](docs/how-it-works.md)**。

## 与 zotero-pdf-translate 的关系

[zotero-pdf-translate](https://github.com/windingwind/zotero-pdf-translate) 是一个成熟、功能极全的插件
（20+ 翻译服务，支持 PDF / EPUB / 网页 / 元数据 / 注释 / 笔记）。**本项目不是它的替代品，
也不打算在功能广度上竞争**，而是刻意做窄：

| 维度     | zotero-pdf-translate | Sense Lingo（本项目）                                               |
| -------- | -------------------- | ------------------------------------------------------------------- |
| 定位     | 全场景翻译工具箱     | 单点做深：划词 + 语境                                               |
| 输入单位 | 词 / 段 / 整篇       | 划选文本 **+ 所在句子**，且**按「词 / 句」分派不同提示词**          |
| 服务商   | 20+，含传统引擎      | 只做 LLM，主打 OpenAI / DeepSeek 兼容协议                           |
| 提示词   | 可配置               | **第一等公民**：词 / 句各一组模板，可保存多套并按类型选用、全变量化 |
| 代码体量 | 大型                 | 有意保持小而可读                                                    |

复用的是**工程实践**而非代码：项目基于
[zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template) 搭建
（TypeScript + `zotero-plugin-scaffold`），划词弹窗使用 Zotero 阅读器公开的
`renderTextSelectionPopup` 事件，服务商抽象参考其「声明式服务定义」写法。

> ⚠️ 若直接搬运 zotero-pdf-translate 的代码，需遵守其 AGPL-3.0 许可（本项目同样采用 AGPL-3.0）。

## 隐私与安全

**这一节必须读**，因为插件会把论文内容发送到第三方服务。

- **发送了什么**：划选的文本 + 上下文（划词为所在句；划句仅在开启「带出前后句」时多带两句，
  均受 `maxSentenceChars` 限制）+ 提示词。**不会**上传整篇 PDF、附件、文献库信息或文件路径。
- **发给了谁**：由 `provider` / `baseURL` 决定。使用 `custom` 时请自行确认该端点可信。
  翻译请求不经过任何本项目的中转服务器。
- **API Key 存储**：保存在本机 Zotero prefs（`extensions.zotero.sense-lingo.apiKey`），**未加密**。
  任何能读取你 Zotero 配置目录的进程都能拿到它；不要在多用户共用机器上使用。
- **日志**：默认不记录原文与译文；开启 `debug` 后会写入 Zotero 调试输出，
  请勿在开启 debug 时截图上报。
- **合规**：请遵守所用服务商的条款，以及所在机构对文献内容外发的规定。
  涉密 / 受限材料请改用本地部署的 OpenAI 兼容端点（`Custom` + 本机地址）。

## 已知限制

1. **扫描版 / 图片型 PDF 没有上下文**：没有文本层时取不到所在句，降级为纯词义翻译，先 OCR 可恢复。
2. **句子定位依赖文本层质量**：双栏、页眉页脚、脚注混排可能导致边界偏移。
3. **类型可能误判**：如 `Not really.`、`state of the art`；面板可一键切换重译，也可调阈值。
4. **音标由大模型生成**：罕见词、专有名词、屈折形式可能不准，关键发音请以词典为准。
5. **快捷键首次需先划一次词**；主窗口触发时没有选区指纹，重复词可能定位到别处。
6. **暂不支持写回注释 / 笔记**，面板目前只提供复制。

完整 15 条限制与逐条排错见 **[故障排查与已知限制](docs/troubleshooting.md)**。

## 路线图

### v0.1 — MVP ✅ 已实现

- [x] 插件骨架、打包与设置页
- [x] 划词弹窗内联译文 + 快捷键结果面板
- [x] 选区类型判定（词 / 句）+ 阈值可配
- [x] 双提示词槽位 + 内置模板 + 变量渲染
- [x] 句子定位（含前后句、指纹消歧）+ 单元测试
- [x] OpenAI / DeepSeek 客户端 + 统一错误处理

### v0.2 — 好用

- [x] 流式输出（默认开启，可关闭）
- [ ] 译文一键写入注释 / 笔记
- [x] 多套提示词管理（增删改、复制、按类型选择、面板即时切换）
- [ ] 提示词导入 / 导出
- [ ] 请求缓存（同一词在同一句只请求一次）

### v0.3 — 更强

- [ ] 术语表与固定译法
- [ ] 段落 / 全文翻译
- [ ] 本地模型适配（Ollama / LM Studio）
- [ ] 生词本导出（CSV / Markdown）

### 长期

- [ ] 多语言 UI 补齐（ja / de / fr）
- [ ] 发布到 Zotero 插件目录

## 开发

```bash
git clone https://github.com/linqingxiao/sense-lingo-zotero.git
cd sense-lingo-zotero
npm install
```

| 命令                 | 作用                                                 |
| -------------------- | ---------------------------------------------------- |
| `npm start`          | 启动开发实例（先按 `.env.example` 配置 Zotero 路径） |
| `npm run build`      | 打包 + 类型检查，产出 `sense-lingo.xpi`              |
| `npm test`           | Vitest 单元测试（13 个文件 / 168 个用例）            |
| `npm run typecheck`  | `tsc --noEmit`                                       |
| `npm run lint:check` | Prettier + ESLint                                    |

- 需要 Node.js ≥ 22.12（Vitest 5 的要求；推荐 24 LTS）与 Zotero 7。
- `typescript` 固定在 6.x（`ts-api-utils` 尚未兼容 TS 7），升级前请确认 lint 仍可用。

环境搭建、调试方式、测试分层、项目结构与发布流程见 **[开发指南](docs/development.md)**。

## 参与贡献

- 发现 Bug 或有功能建议，欢迎开 [Issue](https://github.com/linqingxiao/sense-lingo-zotero/issues)，
  请附上 Zotero 版本、插件版本、服务商与模型名（**不要贴 API Key**）以及相关日志。
- 提交 PR 前请确保 `npm run build`、`npm test`、`npm run lint:check` 全部通过。
- 新的纯逻辑请优先放进 `src/modules/reader/` 或 `src/modules/llm/` 并补单测。

## 致谢与许可

- 架构与工程实践来自 [zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template)、
  [zotero-plugin-scaffold](https://github.com/northword/zotero-plugin-scaffold)、
  [zotero-types](https://github.com/windingwind/zotero-types)；
- 功能设计与交互灵感来自 [zotero-pdf-translate](https://github.com/windingwind/zotero-pdf-translate)；
- 感谢 Zotero 社区。

本项目以 **AGPL-3.0** 许可发布（见 [`LICENSE`](LICENSE)），与参考项目保持一致。
使用前请自行确认所在地区法律法规与服务商条款。
