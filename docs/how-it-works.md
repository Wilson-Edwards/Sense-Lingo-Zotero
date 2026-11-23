# 工作原理

[← 中文 README](../README.zh-CN.md) · [English README](../README.md)

插件刻意保持小而可读：一条主管线，UI 只是调用方。目录职责见文末的[代码导览](#代码导览)。

```text
┌───────────────────────────────┐
│ selectionPopup.ts（弹窗按钮） │   shortcuts.ts（Ctrl/⌘+Shift+T）
└───────────────┬───────────────┘
                ▼
          controller.ts          状态机、错误文案、面板/剪贴板
                ▼
          translate.ts           主管线：类型 → 上下文 → 提示词 → LLM
       ┌────────┴────────┐
       ▼                 ▼
 reader/*（纯函数）   llm/*（prompt / render / client）
```

`reader/` 下与 DOM 无关的部分（类型判定、句子定位、锚点、字号）全是纯函数，
可以直接用 vitest 跑，不需要启动 Zotero。

## 一次划词的完整链路

```text
① 划选文本（一个词 或 一整句），弹窗渲染 / 按下快捷键
        │  text + anchor（祖先块文本、左右各 40 字符指纹）
        ▼
② normalizeText —— 统一换行、去软连字符与零宽字符、NBSP→空格、粘合断词、折叠空白
        │
        ▼
③ Selection Kind Resolver —— 判定选区类型
        │  kind = word | sentence
        ▼
④ Context Resolver —— 按 kind 取上下文
     word     → {sentence} = 该词所在句（消歧依据）
     sentence → {sentence} = 空串；可选 {prevSentence} / {nextSentence}
        │
        ▼
⑤ Prompt Router + Render —— 按 kind 选槽位，替换 {变量}
        │  messages[system, user]
        ▼
⑥ LLM Client —— POST {baseURL}/chat/completions（OpenAI 兼容）
        │  译文 + model + elapsedMs
        ▼
⑦ 输出 —— 弹窗内联译文 / 面板（类型、模板、原句、模型 · 耗时、重译、复制）
```

## ① 捕获划词

- 通过 Zotero 7 的公开接口 `Zotero.Reader.registerEventListener("renderTextSelectionPopup", …)`
  注入「翻译」按钮与译文容器，不修改 Zotero 自身 DOM。
- 弹窗出现的瞬间就抓取现场，因为点按钮时选区可能已经被清空：
  - **祖先块文本**：从 DOM `Range` 向上取 `p` / `div` / `li` / `td` 等块级元素的文本，
    最内层优先，最多 8 层，这是「用户到底在看哪一段」的最可信证据；
  - **指纹**：选区左右各 40 字符，用于在全文里区分同一个词的多次出现。
- 选中文本以 annotation 文本为基准；若实时 DOM 选区是它的**整词子串**（PDF / EPUB 跨 span 时
  annotation 常多带下一行），则改用实时选区文本。若选区已经折叠，则用 annotation 的 position
  通过阅读器内部 API 反解回 `Range`（有保护，失败不影响翻译）。
- 开启 `autoTranslate` 时不渲染按钮，弹窗一出现就直接请求；未配置 API Key 时静默跳过，
  避免每次划词都弹错误。
- 同一个选区在弹窗重复渲染（建注释、重排版、EPUB 换节）时**共享同一个 Promise**，
  并保留 60 秒成功结果缓存；失败的请求不缓存，下一次会重试。
- 快捷键 `Ctrl/⌘ + Shift + T`：阅读器内首次渲染划词弹窗时绑定到该文档（所以新文献要先划一次），
  主窗口也会绑定。主窗口拿不到附件信息，因此只做纯词义翻译。

## ② 规范化文本

`normalizeText()` 是进入管线的第一道处理，类型判定、上下文匹配、提示词都基于同一个表示：

- `\r\n` → `\n`；
- 删除软连字符 `\u00AD` 与零宽字符 `\u200B-\u200D`、`\uFEFF`（EPUB 常见）；
- 不换行空格 `\u00A0` → 普通空格；
- 粘合 PDF 行尾断词：`trans-\nlation` → `translation`；
- 粘合被换行拆开的相邻汉字；
- 折叠连续空白。

## ③ 判定选区类型

判定结果决定**用哪套提示词**，所以规则必须确定且可解释。顺序如下：

1. `selectionKindMode` 为 `alwaysWord` / `alwaysSentence` 时直接返回，跳过以下启发式；
2. 去掉首尾空白后为空 → `word`；
3. **单个 ASCII 词**（1 个空白分隔 token 且不含 CJK）不因句末标点判句——
   PDF 里选 `method.` 不应该走划句模板；
4. 否则，中间或结尾出现真正的句末标点 `. ! ? 。！？` → `sentence`
   （排除 `et al.` / `e.g.` / `Fig.` 等缩写，以及 `3.14` 这类小数点）；
5. 词数 > `wordMaxWords`（默认 3）→ `sentence`；
6. 字符数 > `wordMaxChars`（默认 40）→ `sentence`；
7. 中文字符数 ≥ 8 → `sentence`；
8. 其余 → `word`。

> 单独的换行**不作为**判据：PDF 文本层经常在视觉行尾插入换行，真正的多行长句仍会被
> 标点、词数或字符数规则捕获。

典型结果：`Not really.` → `sentence`（两个 token + 句末标点）；`state of the art` → `sentence`
（超出 3 词）；`mitigate`、`method.` → `word`。

判定不写回设置：结果会显示在结果面板上，一键切换即可重译；也可调阈值，或用
`selectionKindMode` 固定模式。

## ④ 定位句子与上下文

**只有需要上下文时才做这一步**：`word` 看 `useContext`，`sentence` 看 `sentenceContextNeighbors`。

```text
word     → 必须取到该词所在句，填入 {sentence}（消歧的唯一依据）
sentence → 划选本身就是待译正文，{sentence} 置空串
           开启 sentenceContextNeighbors 时再取前后各 1 句
```

### 文本从哪来

按「最便宜 → 最贵」尝试三种来源，任一来源命中即停止：

| 顺序 | 来源           | 说明                                                                                                                 |
| ---- | -------------- | -------------------------------------------------------------------------------------------------------------------- |
| 1    | 附件全文缓存   | `Zotero.Items.get(id).attachmentText`；PDF 未建索引时会按需抽取。EPUB 不走这条（Zotero 无按需抽取路径），交给第 3 层 |
| 2    | 阅读器实时文档 | 锚点块文本优先，然后 BFS 遍历嵌套 `iframe` / `frame`（深度 ≤ 4），取各文档 `body.innerText`，按长度降序尝试          |
| 3    | EPUB 全文      | 复用 Zotero 的 `chrome://zotero/content/EPUB.mjs` 逐节拼接，上限 200 万字符，读完 `close()` 释放 ZipReader           |

第 2 层是 EPUB 的关键：epub.js 把每一节渲染在嵌套 iframe 里，只读外层文档只会拿到工具栏文案。
过短（< 32 字符）的候选视为 UI 噪音，直接跳过。

### 怎么切句

1. 以选中文本为 needle，在全文里做**忽略大小写的索引查找**，得到所有命中位置；
2. 有指纹时，额外做一次**空白不敏感查找**（EPUB 各节 `innerText` 拼接会插入多余空格，
   如 `pro posed`），并把命中位置映射回原文坐标；两批候选合并后统一打分；
3. 有多个候选时按指纹打分选**相似度最高**的位置（左右各 30 字符的公共后缀 / 前缀长度，
   同时比较原样与去空白两种形式），而不是简单取第一处——这是「句子对不上」的根因修复；
   若无指纹，则优先取两侧都是非字母数字边界的那一处，再退化为第一处；
4. 从命中处向前、向后扫描确定句子边界：
   - `。！？` 一律算边界；
   - `!` / `?` 只有在下一个非空白字符不是小写字母时算边界；
   - `.` 排除小数点与已知缩写；若下一个非空白字符是小写字母也不切（防止 PDF 断行把句子切碎）；
5. 前句 / 后句用同样规则再各扩一句；
6. 句子超过 `maxSentenceChars`（默认 400）时按词边界截断，并在面板提示「上下文已截断」。

### 兜底

- 三种来源都没命中 → `hasContext = false`，面板提示「未取到上下文」；
  `word` 模式下 `{sentence}` 为空串，模型自动降级为纯词义翻译；`sentence` 模式本就不依赖它。
- 候选文本完全找不到选中词 → 返回 `null`，按上一条处理。
- 扫描版 PDF 没有文本层 → 先做 OCR 才能恢复上下文。

## ⑤ 提示词路由与渲染

路由只有一行判断，但决定了整条链路的输出风格：

```ts
profileId = kind === "word" ? promptProfileWord : promptProfileSentence;
```

- 两个槽位**完全独立**：改划词模板不会影响划句行为，反之亦然。
- 某个键指向不存在的槽位时，回退到同类型的内置模板，面板模板名会带说明（悬停可见），日志里写一条 `warn`。
- 渲染是**纯文本替换**：`{var}` 命中就替换，未识别的 `{xxx}` 原样保留，
  因此模板里的 LaTeX 和数学公式不会被误伤。

变量与默认模板详见 [提示词自定义](prompts.md)。

## ⑥ 调用大模型

统一走 OpenAI 兼容协议，一家客户端覆盖 OpenAI / DeepSeek / 自建网关：

```http
POST {baseURL}/chat/completions
Authorization: Bearer {apiKey}
Content-Type: application/json

{
  "model": "gpt-4o-mini",
  "messages": [{"role": "system", ...}, {"role": "user", ...}],
  "temperature": 0.3,
  "max_tokens": 1024,
  "stream": false
}
```

- 地址归一：去掉末尾斜杠；只写了主机名时补 `/v1`；已经以 `/chat/completions` 结尾则不再重复拼接。
- `stream` 由设置页的「流式输出」控制：开启后请求带 `"stream": true`，按 SSE 逐段读取
  `data: {...}`，`[DONE]` 结束；服务商忽略该参数、直接返回普通 JSON 时自动回退为一次性解析。
- 请求使用的 `fetch` / `AbortController` / `TextDecoder` 从同一个 Zotero 作用域解析（优先主窗口）：
  插件沙箱里没有 `AbortController`（超时会静默失效），而且部分 Zotero 构建里拿到的 `Response`
  没有可读的 body（流式会退化成“等全部返回再显示”）。三个 API 必须来自同一个 realm，否则跨 realm
  的 `AbortSignal` 会被拒绝。响应体确实读不到时，会在 Zotero 调试输出里留一条
  `WARN streaming unavailable`，便于区分是服务端没有流式返回还是 Zotero 这一层读不到 body。
- 超时用 `AbortController` 实现，默认 30 秒，可在设置里改。流式模式下每收到一段数据就重置计时，
  即超时衡量的是**空闲时间**，避免长译文被总时长误伤。
- 响应兼容 `content` 为字符串或分段数组两种形态；空 `choices` 会被判为错误而不是显示空白。
- 所有失败都归一成带 `code` 的 `LlmError`，由 `controller.ts` 转成界面文案：

| code              | 界面提示                                       |
| ----------------- | ---------------------------------------------- |
| `NOT_CONFIGURED`  | 尚未配置 API Key，请到 设置 → Sense Lingo 填写 |
| `TIMEOUT`         | 请求超时，可调大超时时间或换更快的模型         |
| `NETWORK`         | 网络请求失败，请检查网络或代理                 |
| `HTTP` 401 / 403  | 认证失败，请检查 Key 与模型权限                |
| `HTTP` 其它       | 请求失败（HTTP 状态码 + 服务商返回的错误详情） |
| `PARSE` / `EMPTY` | 模型返回了无法解析的内容，请重试               |

## ⑦ 输出与展示

- **流式输出**：默认开启（设置页可关闭）。收到的每一段增量都会立刻写进划词弹窗的结果容器或结果面板的
  正文区（划词模式用同一套格式归一，所以字词不会在最终结果到达时跳行）；请求结束后的最终
  文案与一次性返回时完全一致。弹窗在请求途中被关闭时，后续增量直接丢弃。
- **划词结果格式归一**：默认模板要求三行（释义 / 美式音标 / 英式音标；人名、地名、品牌名同样适用），模型偶尔会把标签粘在
  同一行。`normalizeWordTranslation()` 会把 `美式音标：` / `英式音标：` 强制拆到独立行，
  再交给 UI 以保留换行的纯文本渲染。
- **划词弹窗**只显示译文本身：`width: max-content` + `max-height: 40vh` + 可滚动，
  字号由 `popupFontSize` 控制，弹窗宽度随字号等比放宽以保持每行字数。
  请求返回前弹窗被关闭时，结果直接丢弃（内联模式的预期行为）。
- **快捷键结果面板**展示更多信息：
  - 顶部：本次判定类型（词 / 句）与所用模板名；
  - 正文：译文；划词模式下再显示命中的原句（取不到时提示「未取到上下文」）；
  - 底部：`模型 · 耗时`，以及「按句重译 / 按词重译」「改提示词」「复制」。
- 面板「改提示词」编辑的是**这一次请求的 user 消息**（变量已渲染），只对本次生效；
  想长期修改请改设置页的 system 模板（见 [提示词自定义](prompts.md)）。

## 缓存与性能

| 缓存      | 作用域         | 失效策略                          |
| --------- | -------------- | --------------------------------- |
| 附件全文  | 每个附件       | 最多保留 8 个附件；重新索引后清空 |
| EPUB 全文 | 每个附件       | 同上；单本上限 200 万字符         |
| 弹窗译文  | 每个阅读器文档 | 同一文本 60 秒内复用；失败不缓存  |
| 选区记录  | 每个阅读器文档 | 只保留最近一次，供快捷键使用      |

## 代码导览

| 位置                        | 职责                                                 |
| --------------------------- | ---------------------------------------------------- |
| `src/index.ts`              | 入口：创建插件实例并挂到 `Zotero.SenseLingo`         |
| `src/hooks.ts`              | 生命周期（启动 / 关闭 / 设置页事件）                 |
| `src/modules/translate.ts`  | 主管线：类型 → 上下文 → 提示词 → LLM                 |
| `src/modules/controller.ts` | UI 与管线之间：状态机、错误文案、剪贴板              |
| `src/modules/reader/*`      | 划词弹窗、快捷键、类型判定、句子定位、文本来源、锚点 |
| `src/modules/llm/prompt.ts` | 两个模板槽位、内置默认模板、路由与回退               |
| `src/modules/llm/render.ts` | 变量替换                                             |
| `src/modules/llm/client.ts` | OpenAI 兼容客户端：地址归一、超时、错误归一          |
| `src/modules/llm/format.ts` | 划词三行格式归一                                     |
| `src/modules/ui/*`          | 结果面板与设置页                                     |
| `addon/prefs.js`            | 全部默认配置                                         |

## 设计取舍与待定问题

以下都是有意为之的取舍，欢迎开 Issue 讨论：

1. **只做 LLM**，不内置 Google / 有道等传统翻译引擎。为了「零配置可用」而引入第二套抽象，
   会稀释「按词/句分派提示词」这个核心。
2. **不默认写注释**。译文只显示、只复制，写回 Zotero 注释需要用户显式点击（见路线图），
   避免污染文献库。
3. **句子定位不做 PDF 坐标级方案**。基于 PDF.js `getTextContent` + bounding box 更精确，
   但实现复杂度和版本耦合都显著上升；当前用文本匹配 + 指纹已能覆盖常见排版。
4. **词与句共用一个模型**。拆成 `modelWord` / `modelSentence` 只需加一个键，
   但会让设置页更复杂，先听使用反馈。
5. **不内置代理设置**。Zotero 本身会读取系统代理；插件内再放一套 `http_proxy` 配置，
   容易和系统设置打架。
6. **类型判定阈值固定为 3 词 / 40 字符**。比「学习用户习惯」更可预测；误判有一键切换兜底。
