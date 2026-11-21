# Sense Lingo for Zotero

> 在 Zotero 7 里划词，用大模型（LLM）翻译。划**一个词**时结合所在句辨析词义，划**一整句**时给出通顺译文——**两套提示词各管一件事，互不干扰**。

<p>
  <img alt="Zotero 7" src="https://img.shields.io/badge/Zotero-7-CC2936?style=flat-square&logo=zotero" />
  <img alt="License" src="https://img.shields.io/badge/license-AGPL--3.0-blue?style=flat-square" />
  <img alt="Status" src="https://img.shields.io/badge/status-v0.1.0-blue?style=flat-square" />
</p>

---

## 目录

- [项目背景](#项目背景)
- [核心特性](#核心特性)
- [与 zotero-pdf-translate 的关系](#与-zotero-pdf-translate-的关系)
- [工作原理](#工作原理)
- [安装](#安装)
- [使用](#使用)
- [配置项](#配置项)
- [提示词自定义](#提示词自定义)
- [开发](#开发)
- [项目结构](#项目结构)
- [隐私与安全](#隐私与安全)
- [路线图](#路线图)
- [已知限制](#已知限制)
- [待确认事项](#待确认事项)
- [致谢与许可](#致谢与许可)

---

## 项目背景

做这个插件的原因很朴素：读英文文献时，只翻译一个单词往往仍然读不懂。

- **孤立的词**丢失了语境。`address` 在 `address the issue` 里是"处理"，在 `email address` 里是"地址"。
- **整段翻译**又太重。我只想知道这一个词/短语在这句话里的意思和用法。
- 通用划词翻译工具把选中的词当作全部输入，**丢掉了它所在的句子**，所以译文经常"对但不对味"。

所以本项目只做一件事：**划词 → 自动抓取该词所在的句子 → 连同句子一起交给大模型 → 得到有语境、可自定义提示词的译文。**

一句话定位：**Zotero 里最懂语境的 AI 划词翻译插件。**

## 核心特性

### v0.1（MVP，计划中）

| 能力               | 说明                                                                                                            |
| ------------------ | --------------------------------------------------------------------------------------------------------------- |
| 🔤 划词 / 划句翻译 | 在 Zotero 阅读器（PDF / EPUB）中选中文本，弹出译文                                                              |
| 🎯 双提示词路由    | **划一个词**和**划一整句**使用两套独立提示词：前者给"语境词义 + 词性"，后者给"通顺译文"。两套互不干扰，分别配置 |
| 🧩 语境增强        | `word` 模式自动带出所在句用于消歧；`sentence` 模式可选带出前后句用于衔接                                        |
| 🤖 多服务商        | 原生支持 **OpenAI** 与 **DeepSeek**，并通过"OpenAI 兼容"模式覆盖任意自建/第三方网关                             |
| ✍️ 自定义提示词    | 模板可完全改写，支持 `{text}` / `{sentence}` / `{selectionType}` 等变量；词、句模板各存一份，可多套切换         |
| 🎛️ 模型可配        | 自定义 `baseURL`、`model`、`temperature`、`max_tokens`                                                          |
| ⚡ 快捷键          | 键盘触发翻译，无需鼠标                                                                                          |
| 🔁 类型可纠正      | 自动判定词/句失误时，面板一键切换类型并立即重译                                                                 |
| 🌐 中英双语界面    | 界面文案通过 Fluent 本地化，默认 `zh-CN` / `en-US`                                                              |

### 后续版本

- 流式输出（先看到字，再看到完整译文）
- 一键把译文写入 Zotero 注释 / 笔记
- 术语表（glossary）：指定领域的固定译法
- 朗读发音、生词本导出
- 全文/段落翻译、摘要翻译
- 按选区类型分配不同模型（小模型翻词、大模型翻句）

## 与 zotero-pdf-translate 的关系

[zotero-pdf-translate](https://github.com/windingwind/zotero-pdf-translate) 是一个成熟、强大、功能极其全面的插件（20+ 翻译服务，支持 PDF / EPUB / 网页 / 元数据 / 注释 / 笔记翻译）。**本项目不是它的替代品，也不打算在功能广度上与之竞争**，而是刻意做窄：

| 维度     | zotero-pdf-translate    | Sense Lingo（本项目）                                      |
| -------- | ----------------------- | ---------------------------------------------------------- |
| 定位     | 全场景翻译工具箱        | 单点做深：划词 + 语境                                      |
| 输入单位 | 词 / 段 / 整篇 / 元数据 | 划选文本 **+ 所在句子**，且**按"词/句"分派不同提示词**     |
| 服务商   | 20+，含传统翻译引擎     | 只做 LLM，主打 OpenAI / DeepSeek 兼容协议                  |
| 提示词   | 可配置                  | **第一等公民**：词、句两套模板独立配置、独立切换，全变量化 |
| 代码体量 | 大型                    | 有意保持小而可读                                           |

我们复用的是它的**工程实践**而非代码：

- 项目基于 [zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template) 搭建（TypeScript + `zotero-plugin-scaffold` + `ztoolkit`）；
- 划词弹窗复用 Zotero 阅读器公开的 `renderTextSelectionPopup` 事件钩子；
- 服务商抽象参考其 `services/*.ts` 的"声明式服务定义"写法。

> ⚠️ 本项目为独立实现。若直接搬运 zotero-pdf-translate 的代码，需遵守其 AGPL-3.0 许可（本项目同样采用 AGPL-3.0）。

## 工作原理

```text
① 划选文本（一个词 或 一整句）
        │
        ▼
② 读取 selectionText
        │
        ▼
③ Selection Kind Resolver —— 判定选区类型
     词数 ≤ 3 · 无句末标点 · ≤ 40 字符 · 未跨行  →  word
     其余条件                                    →  sentence
        │  kind
        ▼
④ Context Resolver —— 按 kind 取不同上下文
     word      →  {sentence} = 该词所在句（消歧依据）
     sentence  →  {sentence} = 空串
                  可选 {prevSentence} / {nextSentence}
        │
        ▼
⑤ Prompt Router —— 按 kind 选模板 + 变量渲染
     word      →  promptProfileWord      （默认模板 id: word）
     sentence  →  promptProfileSentence  （默认模板 id: sentence）
        │  ⑥ messages[]
        ▼
⑦ LLM Client（OpenAI 兼容）→ POST {baseURL}/chat/completions
        │  ⑧ 译文
        ▼
⑨ 结果面板 / 回填注释（显示判定类型，支持一键切换 kind 重译）
```

### 关键步骤说明

**① 捕获划词**
监听 Zotero 阅读器 `renderTextSelectionPopup`，在原生弹窗中注入"翻译"按钮；同时注册快捷键，直接对当前 selection 触发翻译。

**② 取选中文本**
`event.params.annotation.text` 与 `reader._internalReader._lastSelectText` 二选一：优先取 annotation 文本，回退到 selection 缓存；两者都为空时提示用户重新划词。

**③ 判定选区类型（word / sentence）**
这一步决定后面**用哪套提示词**，因此必须确定且可解释。判定为启发式，只看选中文本自身特征：

1. 含句末标点 `. ! ? 。！？`（排除 `et al.` / `e.g.` / `Fig.` 等已知缩写）→ `sentence`
2. 词数 ≥ `wordMaxWords`（默认 3）→ `sentence`
3. 字符数 > `wordMaxChars`（默认 40）→ `sentence`
4. 跨行划选（含换行）→ `sentence`
5. 以上都不满足 → `word`

`selectionKindMode` 可设 `alwaysWord` / `alwaysSentence` 直接跳过判定（习惯固定模式的用户）。判定结果会随请求一起进入日志与面板，面板上始终显示"本次判定为：词 / 句"并支持一键切换重译——这比调阈值更快，也不污染全局设置。

**④ 定位句子与上下文（本项目的核心难点）**
两种类型取上下文的策略**不同**：

- `word`：**必须**定位到该词所在的句子，填入 `{sentence}`。这是消歧的唯一依据，取不到就退化为词典式直译（`useContext = false` 时整步跳过，等同词典式查询）。
- `sentence`：划选本身就是待译正文，`{sentence}` 置为空串，避免与 `{text}` 重复导致模型复读；若 `sentenceContextNeighbors = true`，再取前后各 1 句填入 `{prevSentence}` / `{nextSentence}`（默认关闭，因为会显著增加 token）。

句子定位不依赖 PDF 坐标，而是走**文本层匹配**：

1. **取文本：从"最精确"到"最宽泛"四级回退**（每级都缓存，任一级失败不影响翻译）
   - ① **附件全文**：`Zotero.Items.get(attachmentID).attachmentText`，读 Zotero 的全文缓存（`.zotero-ft-cache`）；PDF 未建索引时会按需调用 `Zotero.PDFWorker.getFullText` 抽取。
   - ② **选区锚点块**（最精确）：划词瞬间从 DOM `Range` 记录选区所在的**祖先块文本**（最内层块优先，深度 ≤ 8，跳过 `body`/`html`）。点击"翻译"按钮时选区可能已被清空，所以必须在弹出那一刻抓取。
   - ③ **阅读器文档文本**：从选区所在文档出发，**递归遍历嵌套 iframe/frame（深度 ≤ 4）**，把每个文档的 `body.innerText` 当作候选，按长度降序尝试。这层是 EPUB 的关键——epub.js 把每一节渲染在嵌套 iframe 里，只读外层文档只会拿到工具栏文案。
   - ④ **EPUB 全文**：仍未命中时，复用 Zotero 自己的 `chrome://zotero/content/EPUB.mjs` 逐节拼出整本书文本（上限 200 万字符，读完 `close()` 释放 ZipReader），与 Zotero 建索引的方式一致。
   - 四级都不命中 → 没有上下文，按下面的兜底策略降级，并在面板提示"未取到上下文"。
2. 以选中文本为 needle 在全文中做索引查找，命中位置记为 `[start, end)`；
3. 从 `start` 向前、从 `end` 向后扫描，遇句末标点（`. ! ? 。！？` 及其后紧跟空白/换行）即止，得到候选句子（前后句用同样方式再各扩一句）；
4. 处理已知坑：缩写（`et al.` `e.g.` `Fig.` `vs.`）、小数点、引用编号 `[12]`、换行断词（`trans-\nlation`）、软连字符与零宽字符（EPUB 常见）、不换行空格 `\u00A0`、页眉页脚混入；
5. **空白不敏感二次匹配**：EPUB 的索引文本由各节 `innerText` 拼接，节点边界会插入多余空格（如 `pro posed`），精确查不到时去掉两侧所有空白再比对，并把命中位置映射回原文坐标；
6. **指纹消歧**：同一个词在全书出现多次（或同段出现两次）时，把每个候选位置左右各 30 字符与选区指纹（划词时抓取的左右各 40 字符）比对，取**相似度最高**的位置，而不是简单取第一处——这是"句子对不上"的根因修复；
7. 句子长度超过 `maxSentenceChars`（默认 400）时向下截断并在日志中标注，避免把整页当上下文。

**兜底策略（按优先级）**：定位到唯一句子 → 定位到多个候选时取离选中文本最近的 1 条 → 分句失败时回退为"前后各 N 字符的窗口" → 仍失败则不注入上下文：`word` 模式下 `{sentence}` 为空串，模型自动降级为纯词义翻译；`sentence` 模式不受影响（它本来就不依赖上下文句子）。两种情况下结果面板都会提示"未取到上下文"。

**⑤～⑨ 模板路由、调用与展示**
路由是这一步的核心，只有一行判断，但决定了整条链路的输出风格：

```
profileId = (kind === "word") ? prefs.promptProfileWord
                              : prefs.promptProfileSentence
```

- 两个键**完全独立**：改 `promptProfileWord` 不会影响划句行为，反之亦然；
- 某个键指向不存在的模板时，回退到内置的 `word` / `sentence` 默认模板，并写一条 `warn` 日志，绝不静默失败；
- `promptProfiles` 里每个模板的 `kind` 字段只用于设置页分组展示，**不参与路由**（避免"改了 kind 却不生效"的困惑）。

请求统一走 OpenAI 兼容协议：`POST {baseURL}/chat/completions`，`Authorization: Bearer {apiKey}`。DeepSeek 只是 `baseURL` 与 `model` 的预设差异（`https://api.deepseek.com/v1` + `deepseek-chat`），因此**一家客户端覆盖两家服务商**，第三方兼容网关同理。

## 安装

> 状态：v0.1.0 已可自构建安装，暂无正式 Release。想直接用请按下面的"本地构建"三步走。

**本地构建**

```bash
npm install
npm run build
# 产物：.scaffold/build/sense-lingo.xpi
```

然后在 Zotero 里 `工具 → 插件 → 齿轮 → Install Plugin From File…` 选择该 xpi。

**正式安装（发布后）**

1. 从 [Releases](https://github.com/linqingxiao/sense-lingo-zotero/releases) 下载 `sense-lingo.xpi`；
2. Zotero → `工具 / Tools` → `插件 / Plugins` → 右上角齿轮 → `Install Plugin From File…`；
3. 选择 xpi 文件，重启 Zotero；
4. 需要 **Zotero 7.0 ~ 11.x**（`addon/manifest.json` 的 `strict_min_version` / `strict_max_version`）。

> ⚠️ **Zotero 升级后装不上的第一嫌疑就是这里**。`strict_max_version` 是硬上限：写成 `"8.*"` 时，Zotero 10 会直接报"它可能无法与该版本的 Zotero 兼容"。Zotero 每次大版本更新后，把 `strict_max_version` 往前推一位并重新 `npm run build` 即可。
>
> 排查命令（确认打包产物里的真实取值）：
>
> ```bash
> unzip -p .scaffold/build/sense-lingo.xpi manifest.json | grep strict_
> ```

## 使用

1. 打开任意 PDF / EPUB 附件；
2. 选中文本——**选一个词**或**选一整句**都可以，插件自动判定类型；
3. 点击弹窗中的 **翻译** 按钮（或按快捷键 `Ctrl/⌘ + Shift + T`）；
4. 结果面板显示：**译文**、**本次判定类型**（词 / 句）、**使用的模板名**、命中的原句、模型与耗时；
5. 判定不符合预期时，面板顶部可一键在「词 / 句」间切换并立即重译——只影响本次，不写回设置；
6. 面板内还可展开提示词临时改一版再试，满意后存为新模板。

### 同一句话，两种划法

以 `The results suggest that the proposed method can mitigate the inherent noise.` 为例：

| 划选内容                            | 判定       | 走的模板                             | 期望输出                                           |
| ----------------------------------- | ---------- | ------------------------------------ | -------------------------------------------------- |
| `mitigate`                          | `word`     | `promptProfileWord` → `word`         | `减轻（v.）；在此句中指降低…的程度`                |
| `inherent`                          | `word`     | `promptProfileWord` → `word`         | `固有的（adj.）；句中修饰 noise，指数据自带的噪声` |
| `The results suggest that … noise.` | `sentence` | `promptProfileSentence` → `sentence` | `结果表明，所提方法能够减轻固有噪声。`             |

关键差别：**划词时模型必须解释"在这个句子里它是什么意思"，划句时模型只需给出通顺译文、不要解释。**

首次使用必须先配置 API Key（见下一节），否则点击翻译会引导到设置页。

## 配置项

设置入口：`编辑 / Edit` → `设置 / Settings` → `Sense Lingo`。

> 下表 `键` 为简化名，实际完整键名为 `extensions.zotero.sense-lingo.<键>`，默认值写在 `addon/prefs.js` 中。

| 键                         | 类型         | 默认值        | 说明                                                                                                        |
| -------------------------- | ------------ | ------------- | ----------------------------------------------------------------------------------------------------------- |
| `provider`                 | string       | `openai`      | 服务商预设：`openai` / `deepseek` / `custom`                                                                |
| `apiKey`                   | string       | `""`          | API Key。保存在 Zotero prefs 中（**明文**，见[隐私与安全](#隐私与安全)）                                    |
| `baseURL`                  | string       | 跟随 provider | 接口地址，可在 `custom` 下自由填写，自动补 `/v1` 时需注意末尾斜杠                                           |
| `model`                    | string       | 跟随 provider | 模型名，如 `gpt-4o-mini` / `deepseek-chat`                                                                  |
| `temperature`              | string       | `"0.3"`       | 越低越稳定，翻译建议 0～0.5。**按字符串存储**，因为 Firefox pref 只支持 int/bool/string，float 会被静默截断 |
| `maxTokens`                | number       | `1024`        | 单次回复上限                                                                                                |
| `targetLang`               | string       | `zh-CN`       | 目标语言；设为 `auto` 时按 Zotero 界面语言推断                                                              |
| `sourceLang`               | string       | `auto`        | 源语言；默认由模型自行判断                                                                                  |
| `selectionKindMode`        | string       | `auto`        | 选区类型判定：`auto` 自动判定 / `alwaysWord` 一律按词 / `alwaysSentence` 一律按句                           |
| `wordMaxWords`             | number       | `3`           | 判定为"词"的最大词数，超出则按句处理                                                                        |
| `wordMaxChars`             | number       | `40`          | 判定为"词"的最大字符数，超出则按句处理                                                                      |
| `useContext`               | boolean      | `true`        | **仅 `word` 模式**：是否带出所在句（关闭后等同词典式直译）                                                  |
| `sentenceContextNeighbors` | boolean      | `false`       | **仅 `sentence` 模式**：是否取前后各一句填入 `{prevSentence}` / `{nextSentence}`                            |
| `maxSentenceChars`         | number       | `400`         | 单句上下文长度上限，超出则截断                                                                              |
| `promptProfileWord`        | string       | `word`        | **划词**时使用的提示词模板 id                                                                               |
| `promptProfileSentence`    | string       | `sentence`    | **划句**时使用的提示词模板 id                                                                               |
| `promptProfiles`           | string(JSON) | 见下          | 提示词模板集合，词模板与句模板分别存放                                                                      |
| `showInPopup`              | boolean      | `true`        | 是否在划词弹窗注入翻译按钮                                                                                  |
| `shortcutEnabled`          | boolean      | `true`        | 是否启用快捷键 `Ctrl/⌘ + Shift + T`                                                                         |
| `requestTimeoutMs`         | number       | `30000`       | 请求超时；超时后提示重试而非静默失败                                                                        |
| `debug`                    | boolean      | `false`       | 输出详细日志到 Zotero `帮助 → 调试输出`                                                                     |

服务商预设对照：

| provider   | baseURL                       | 默认 model      |
| ---------- | ----------------------------- | --------------- |
| `openai`   | `https://api.openai.com/v1`   | `gpt-4o-mini`   |
| `deepseek` | `https://api.deepseek.com/v1` | `deepseek-chat` |
| `custom`   | 用户填写                      | 用户填写        |

## 提示词自定义

提示词按"模板集合"存储，**词模板与句模板分开管理**：划词走一套，划句走另一套，互不干扰。

### 路由规则

| 选区类型   | 判定条件（默认阈值）                    | 使用的配置键            | 默认模板 id |
| ---------- | --------------------------------------- | ----------------------- | ----------- |
| `word`     | 词数 ≤ 3、无句末标点、≤ 40 字符、未跨行 | `promptProfileWord`     | `word`      |
| `sentence` | 其余情况                                | `promptProfileSentence` | `sentence`  |

- 两个键**完全独立**：只改 `promptProfileWord` 时，划句行为完全不变；反之亦然。
- 想同时维护"论文精读"和"日常速览"两套风格？各准备一对词/句模板，然后同时切换 `promptProfileWord` 与 `promptProfileSentence`。
- 键指向不存在的模板 id → 回退到内置的 `word` / `sentence` 模板，并写一条 `warn` 日志，不会静默失败。

### 默认存储结构

`extensions.zotero.sense-lingo.promptProfiles` —— 词、句模板各两份示例：

```json
{
  "word": {
    "name": "划词 · 语境辨析",
    "kind": "word",
    "system": "You are a precise bilingual lexicographer. Translate the selected text into {targetLang}, using the given sentence to disambiguate word sense.",
    "user": "Sentence: {sentence}\nSelected text: {text}"
  },
  "word-casual": {
    "name": "划词 · 只要中文意思",
    "kind": "word",
    "system": "Translate into {targetLang}. Output the contextual meaning only, no explanation.",
    "user": "{text}\n({sentence})"
  },
  "sentence": {
    "name": "划句 · 通顺翻译",
    "kind": "sentence",
    "system": "You are a precise academic translator. Translate the text into {targetLang}. Output plain text only.",
    "user": "{text}"
  },
  "sentence-neighbor": {
    "name": "划句 · 带前后句衔接",
    "kind": "sentence",
    "system": "You are a precise academic translator. Translate the text into {targetLang}, keeping coherence with the neighboring sentences. Output only the translation of the text.",
    "user": "Previous: {prevSentence}\nText: {text}\nNext: {nextSentence}"
  }
}
```

`kind` 字段仅用于设置页分组展示，**不参与路由**——路由只看 `promptProfileWord` / `promptProfileSentence`。这样做是为了避免"把 kind 改了却不生效"这类困惑。

### 可用变量

两种模式共用同一套变量，区别在**取值策略**：

| 变量                            | 含义                          | `word` 模式取值             | `sentence` 模式取值                       |
| ------------------------------- | ----------------------------- | --------------------------- | ----------------------------------------- |
| `{text}`                        | 划选的原始文本                | 选中的词 / 短语             | 选中的整句 / 整段                         |
| `{sentence}`                    | 上下文句子                    | `{text}` 所在的完整句子     | **空串**（与 `{text}` 重复，故置空）      |
| `{prevSentence}`                | 前一句                        | 空串                        | 仅 `sentenceContextNeighbors=true` 时有值 |
| `{nextSentence}`                | 后一句                        | 空串                        | 同上                                      |
| `{selectionType}`               | 本次判定结果                  | `word`                      | `sentence`                                |
| `{sourceLang}` / `{targetLang}` | 语言设置                      | `auto` 时不替换为具体语言名 | 同左                                      |
| `{itemTitle}`                   | 当前文献标题                  | 非附件场景为空串            | 同左                                      |
| `{word}`                        | `{text}` 的别名（兼容旧模板） | 同 `{text}`                 | 同 `{text}`                               |

> 变量只做**纯文本替换**，不执行任何表达式；模板中未识别的 `{xxx}` 原样保留，避免误伤数学公式与 LaTeX。

**为什么 `sentence` 模式下 `{sentence}` 是空串？** 若让它等于 `{text}`，默认模板里就会出现两遍同样的句子，模型容易复读或"翻译两遍"。因此约定：`{sentence}` 只承载"待译文本之外的上下文"。确实需要把整句喂给模型时，用 `{text}` 即可。

### 默认模板 A：划词（`word`）

```text
[system]
You are a precise bilingual lexicographer.

Translate the selected text into {targetLang}. You are given the sentence it
appears in — use it ONLY to disambiguate word sense, part of speech and
collocation. Do not translate or paraphrase the sentence itself.

Rules:
1. Output format: "语境词义（词性）", e.g. "减轻（v.）".
2. If the selection is a fixed term or acronym, give the accepted translation
   first, then a gloss of its meaning in this paper (<= 20 chars).
3. Keep formulas, citation markers and proper nouns intact.
4. No pinyin, no pronunciation, no extra commentary.

[user]
Sentence: {sentence}
Selected text: {text}
```

### 默认模板 B：划句（`sentence`）

```text
[system]
You are a precise academic translator.

Translate the text into {targetLang}. The text is already a complete sentence
or a passage, so do not explain and do not add notes — just deliver a faithful,
readable translation.

Rules:
1. Preserve terminology, numbers, formulas, citation markers and proper nouns.
2. Keep the original sentence order; do not merge or split sentences.
3. Output plain text only, never Markdown headings or bullet lists.
4. If the text is already in {targetLang}, output it unchanged.

[user]
{text}
```

对照着看就很清楚：**A 的产出一行"词义 + 词性"，B 的产出一段可直接引用的译文。** 这就是把提示词按选区类型分开的意义——同一套模板无法同时把两件事做好。

### 自定义示例：划词"术语速查" + 划句"直译"

把 `promptProfileWord` 指向 `term-lookup`：

```text
句子：{sentence}
选中：{text}
目标语言：{targetLang}

请给出：
1) 该词在此句中的准确译法；
2) 词性与常见搭配；
3) 若为术语，给出该文献语境下的解释（不超过 20 字）。
```

把 `promptProfileSentence` 指向 `literal`：

```text
把下面的文本直译为 {targetLang}，保留句序与术语，不要润色、不要解释：
{text}
```

模板重置：设置页的"恢复默认提示词"只重写内置的 `word` 与 `sentence` 两份模板，**不会**动用户自建的模板，也不会修改 `promptProfileWord` / `promptProfileSentence` 当前的指向。

## 开发

### 环境要求

- Node.js ≥ 18，npm ≥ 9
- Zotero 7（7.0+，建议 beta 与稳定版都测）
- 用于调试的 Zotero 配置目录（`-profile` 参数或 scaffold 自动创建）

### 命令

```bash
git clone https://github.com/linqingxiao/sense-lingo-zotero.git
cd sense-lingo-zotero
npm install

npm start           # 开发实例（先把 .env.example 复制为 .env 并填 Zotero 路径）
npm run build       # 产出 .scaffold/build/sense-lingo.xpi
npm test            # vitest 单元测试
npm run typecheck   # tsc --noEmit
npm run lint:check  # prettier --check + eslint
```

> 📌 现实约束：根依赖 `typescript` 固定在 **6.x**，因为 `@typescript-eslint` 依赖的 `ts-api-utils` 尚未兼容 TS 7；升级前请先确认 lint 仍可用。

### 调试

- `帮助 → 调试输出`：查看 `Sense Lingo` 前缀的日志；
- 端口 6000 的远程调试（Firefox 调试器），可按 `about:debugging` 方式附加；
- 修改 `src/` 后热重载，修改 `addon/manifest.json` / `prefs.js` 后需重启。

### 测试策略

`npm test` 用 [vitest](https://vitest.dev/) 直接跑纯函数，不需要启动 Zotero；当前 **74 个用例全部通过**。

| 层             | 是否单测 | 说明                                                                                                                     |
| -------------- | -------- | ------------------------------------------------------------------------------------------------------------------------ |
| 选区类型判定   | ✅ 必测  | 边界值：1 / 3 / 4 词、含 / 不含句末标点、跨行、中英混排、纯数字；阈值可配后需覆盖 `alwaysWord` / `alwaysSentence`        |
| 提示词路由     | ✅ 必测  | `word` 取 `promptProfileWord`、`sentence` 取 `promptProfileSentence`；两键互不影响；指向不存在的 id 时回退内置模板并告警 |
| 分句与文本定位 | ✅ 必测  | 纯函数，输入文本片段 → 期望句子；覆盖缩写、换行断词、多命中、无命中、前后句扩展                                          |
| 提示词渲染     | ✅ 必测  | 变量替换、未知变量保留、`{sentence}` 在 sentence 模式为空串、前后句未开启时为空串                                        |
| LLM 响应解析   | ✅ 必测  | 正常 / 空 choices / 错误码 / 超时 / 非 JSON                                                                              |
| Zotero UI 注入 | ⚠️ 手工  | 依赖真实阅读器，靠人工回归                                                                                               |
| 端到端         | ⚠️ 手工  | 真实 API Key 下分别跑一遍"划词"和"划句"主流程                                                                            |

## 项目结构

```text
.
├── addon/                          # 静态资源（打包进 xpi）
│   ├── manifest.json               # 插件元信息、兼容版本
│   ├── bootstrap.js                # Zotero 7 bootstrap 入口
│   ├── prefs.js                    # 默认偏好设置（本文档"配置项"的来源）
│   ├── content/
│   │   ├── preferences.xhtml       # 设置页（XUL + html: 混合片段）
│   │   ├── preferences.js          # 设置页 shim：监听 showing 事件
│   │   └── icons/                  # favicon.png / favicon@0.5x.png
│   └── locale/
│       ├── en-US/ { addon, preferences }.ftl
│       └── zh-CN/ { addon, preferences }.ftl
├── src/
│   ├── index.ts                    # 入口：创建 addon 实例并挂到 Zotero
│   ├── hooks.ts                    # 生命周期 / 设置页事件分发
│   ├── addon.ts                    # 插件基类与全局状态
│   ├── modules/
│   │   ├── translate.ts            # 主管线：类型 → 上下文 → 提示词 → LLM
│   │   ├── controller.ts           # UI 与管线之间：状态机 + 错误文案
│   │   ├── reader/
│   │   │   ├── selectionPopup.ts   # 划词弹窗按钮注入
│   │   │   ├── selectionKind.ts    # word / sentence 判定（纯函数）
│   │   │   ├── sentence.ts         # 句子定位 + 前后句（纯函数）
│   │   │   ├── textSource.ts       # Zotero.Fulltext 取全文 + 缓存
│   │   │   ├── selectionState.ts   # 每个文档最近一次选区
│   │   │   └── shortcuts.ts        # Ctrl/⌘+Shift+T
│   │   ├── llm/
│   │   │   ├── client.ts           # OpenAI 兼容客户端（超时/错误码归一）
│   │   │   ├── providers.ts        # openai / deepseek / custom 预设
│   │   │   ├── prompt.ts           # 模板集合、默认模板、路由与回退
│   │   │   └── render.ts           # 变量渲染
│   │   └── ui/
│   │       ├── resultPanel.ts      # 阅读器内的译文面板
│   │       └── preferences.ts      # 设置页逻辑与 JSON 校验
│   └── utils/
│       └── prefs.ts  locale.ts  logger.ts
├── test/                           # vitest 单元测试
├── typings/global.d.ts             # 全局声明 + PluginPrefsMap
├── zotero-plugin.config.ts         # scaffold 配置
├── eslint.config.mjs
└── package.json
```

## 隐私与安全

**必须读**，因为本插件会把论文内容发送到第三方服务。

- **发送了什么**：划选的文本 + 上下文（`word` 模式为所在句；`sentence` 模式仅在开启 `sentenceContextNeighbors` 时带前后各一句，均受 `maxSentenceChars` 限制）+ 提示词。**不会**上传整篇 PDF、附件、文献库信息或文件路径。
- **发给了谁**：由 `provider` / `baseURL` 决定。使用 `custom` 时请自行确认该端点可信。翻译请求不经过任何本项目的中转服务器。
- **API Key 存储**：保存在本机 Zotero prefs（`extensions.zotero.sense-lingo.apiKey`），**未加密**。任何能读取你 Zotero 配置目录的进程都能拿到它。不要在多用户共用机器上使用。
- **日志**：默认不记录原文与译文；`debug` 开启后会写入 Zotero 调试输出，请勿在开启 debug 时截图上报。
- **合规**：请遵守你所用服务商的条款，以及所在机构对文献内容外发的规定。涉密/受限材料请改用本地部署的 OpenAI 兼容端点。

## 路线图

### v0.1 — MVP ✅ 已实现

- [x] 插件骨架（template + scaffold + 打包）
- [x] 设置页：provider / apiKey / model / targetLang
- [x] 划词弹窗注入按钮 + 快捷键
- [x] 选区类型判定（word / sentence）+ 阈值可配 + 单测
- [x] 双提示词槽位 `promptProfileWord` / `promptProfileSentence` + 内置 `word` / `sentence` 模板
- [x] 句子定位算法（含前后句扩展）+ 单测
- [x] OpenAI / DeepSeek 客户端 + 错误处理
- [x] 提示词模板渲染（路由 + 变量）+ 单测
- [x] 结果面板（显示判定类型，支持一键切换重译、临时改提示词、复制）

> v0.1 未包含 CI workflow（`.github/workflows`），如需自动打包与 Release 请补上。

### v0.2 — 好用

- [ ] 流式输出
- [ ] 译文一键写入注释 / 笔记
- [ ] 多套提示词管理 UI（增删改、导入导出）
- [ ] 请求缓存（同一词在同一句只请求一次）

### v0.3 — 更强

- [ ] 术语表与固定译法
- [ ] 段落 / 全文翻译
- [ ] 本地模型适配（Ollama / LM Studio）
- [ ] 生词本导出（CSV / Markdown）

### 长期

- [ ] 多语言 UI 补齐（ja / de / fr）
- [ ] 发布到 Zotero 插件目录

## 已知限制

1. **扫描版 / 图片型 PDF 没有上下文**。没有文本层时取不到所在句，面板会提示"未取到上下文"并降级为纯词义翻译；先做 OCR 即可恢复。
2. **句子定位依赖文本层质量**。双栏排版、页眉页脚、脚注混排可能导致句子边界识别偏移，此时会退化为字符窗口。
3. **公式与表格**：PDF 文本层里的公式往往乱序，译文可能失真；建议只选普通正文。
4. **Token 成本**：`word` 模式每次带一句上下文，比纯词翻译贵但远低于整段翻译；`sentence` 模式开启 `sentenceContextNeighbors` 后上下文最多翻三倍，注意成本。
5. **选区类型可能误判**。典型误判：`Not really.`（含句末标点 → 判为 `sentence`）、四词术语 `state of the art`（超出 `wordMaxWords` → 判为 `sentence`）、跨行被断开的单个长词（判为 `sentence`）。面板可一键切换类型重译；也可调 `wordMaxWords` / `wordMaxChars`，或设 `selectionKindMode` 强制单一模式。
6. **不支持 Zotero 6**。
7. **划词弹窗按钮位置**受阅读器版本影响，Zotero 升级后可能需要适配。
8. **快捷键首次需先划一次词**。`keydown` 监听是在阅读器首次触发 `renderTextSelectionPopup` 时绑定到该文档上的；打开新文献后先划一下，之后快捷键即可用。
9. **暂不支持把译文写回注释 / 笔记**（v0.2），面板目前只提供复制。
10. **EPUB 的上下文来源分四级**：附件全文缓存 → 选区锚点块 → 阅读器文档（含嵌套 iframe）→ Zotero 的 EPUB 解析器。最后一级要读整本书，**首次触发会慢 1～3 秒**（之后按附件缓存）。若四级都取不到才会提示"未取到上下文"。
11. **没有选区指纹时可能取到重复词的错误位置**。指纹在主窗口里通过快捷键触发时拿不到（阅读器内触发没问题），此时若同一个词在文本里出现多次，只能回退到"第一个合理位置"。

## 待确认事项

以下决策尚未拍板，欢迎开 Issue 讨论：

1. **插件标识**：`addonRef` 用 `sense-lingo`，插件 ID 用 `sense-lingo@linqingxiao.github.io`？是否有既有命名习惯需要遵循。
2. **License**：默认 AGPL-3.0（与参考项目一致）。若希望更宽松（MIT/Apache-2.0），现在改成本最低。
3. **是否内置传统翻译引擎**（如 Google / 有道）作为"零配置可用"兜底？我的倾向是**不做**，保持"只做 LLM"的纯度。
4. **翻译结果是否默认写入注释**？倾向默认**不写**，改为面板内显式按钮，避免污染文献库。
5. **是否需要代理设置**（`http_proxy`）在插件内可配？面向中国大陆用户可能必要。
6. **句子定位的替代方案**：是否需要更精确的坐标级方案（基于 PDF.js 的 `getTextContent` + bounding box），代价是实现复杂度显著上升。
7. **选区类型判定的阈值与默认值**：默认"≤ 3 词且 ≤ 40 字符且无句末标点"判为 `word`。是否还要"学习用户习惯"（同一文献内连续两次手动切换后，临时记住该偏好）？`sentenceContextNeighbors` 是否应该默认开启而不是 `false`？
8. **是否允许词/句使用不同模型**：例如划词用 `gpt-4o-mini`、划句用 `deepseek-chat`（成本与质量权衡）。目前设计为共用一套 `model`，拆分只需加一个 `modelSentence` 键，但会让设置页变复杂，想先听意见。

## 致谢与许可

- 架构与工程实践来自 [zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template)、[zotero-plugin-scaffold](https://github.com/northword/zotero-plugin-scaffold)、[zotero-types](https://github.com/windingwind/zotero-types)；
- 功能设计与交互灵感来自 [zotero-pdf-translate](https://github.com/windingwind/zotero-pdf-translate)；
- 感谢 Zotero 社区。

本项目以 **AGPL-3.0** 许可发布（见 `LICENSE`），与参考项目保持一致。使用前请自行确认所在地区法律法规与服务商条款。
