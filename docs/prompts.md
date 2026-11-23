# 提示词自定义

[← 中文 README](../README.zh-CN.md) · [English README](../README.md)

本站唯一的「魔法」就在这里：**划词和划句走两套完全独立的提示词**。

设置页的「提示词模板」区域有两个多行文本框：

| 文本框          | 槽位 id    | 什么时候用           |
| --------------- | ---------- | -------------------- |
| 划词 · 语境辨析 | `word`     | 选区被判定为「词」时 |
| 划句 · 通顺翻译 | `sentence` | 选区被判定为「句」时 |

- 框里填的是发给模型的 **system** 提示词，直接编辑即可，**换行原样保留**（不用写 `\n`）。
- 划选的文本与上下文由插件自动附在 user 消息里，模板中不必再手写一遍。
- 留空 = 使用该槽位的内置默认模板；点「恢复内置默认模板」会同时清空两个槽位。
- 两个槽位互不影响：只改划词模板，划句行为完全不变，反之亦然。

## 路由规则

```
profileId = (kind === "word") ? promptProfileWord : promptProfileSentence
```

| 选区类型   | 判定条件（默认阈值）                      | 使用的文本框                  |
| ---------- | ----------------------------------------- | ----------------------------- |
| `word`     | 词数 ≤ 3、无句末标点、≤ 40 字符、非长中文 | 划词 · 语境辨析（`word`）     |
| `sentence` | 其余情况                                  | 划句 · 通顺翻译（`sentence`） |

完整判定顺序见 [工作原理](how-it-works.md)。

- 设置页把内容写回 `promptProfiles` 的两个固定槽位；`promptProfileWord` /
  `promptProfileSentence` 仍保留，用于兼容旧配置。
- 路由键指向不存在的槽位时，回退到同类型的内置模板，面板模板名会带说明（悬停可见），
  日志里写一条 `warn`。绝不静默失败。
- 两个文本框都等于内置模板时，`promptProfiles` 存为空串，方便以后升级默认模板；
  一旦自定义才写入 JSON。

## 可用变量

两种模式共用同一套变量，区别在**取值策略**：

| 变量                            | 含义                          | `word` 模式取值         | `sentence` 模式取值                       |
| ------------------------------- | ----------------------------- | ----------------------- | ----------------------------------------- |
| `{text}`                        | 划选的原始文本                | 选中的词 / 短语         | 选中的整句 / 整段                         |
| `{sentence}`                    | 上下文句子                    | `{text}` 所在的完整句子 | **空串**（与 `{text}` 重复，故置空）      |
| `{prevSentence}`                | 前一句                        | 空串                    | 仅 `sentenceContextNeighbors=true` 时有值 |
| `{nextSentence}`                | 后一句                        | 空串                    | 同上                                      |
| `{selectionType}`               | 本次判定结果                  | `word`                  | `sentence`                                |
| `{sourceLang}` / `{targetLang}` | 语言设置                      | 原样取自 pref           | 同左                                      |
| `{itemTitle}`                   | 当前文献标题                  | 非附件场景为空串        | 同左                                      |
| `{word}`                        | `{text}` 的别名（兼容旧模板） | 同 `{text}`             | 同 `{text}`                               |

> 变量只做**纯文本替换**，不执行任何表达式；模板中未识别的 `{xxx}` 原样保留，
> 避免误伤数学公式与 LaTeX。`{ targetLang }` 这种带空格的写法也能识别。

**为什么 `sentence` 模式下 `{sentence}` 是空串？**
若让它等于 `{text}`，默认模板里就会出现两遍同样的句子，模型容易复读或「翻译两遍」。
因此约定：`{sentence}` 只承载「待译文本之外的上下文」。确实需要把整句喂给模型时，用 `{text}` 即可。

## 存储结构

`extensions.zotero.sense-lingo.promptProfiles` 是一个 JSON 字符串，只有两个槽位：

```json
{
  "word": {
    "name": "划词 · 语境辨析",
    "kind": "word",
    "system": "…设置页第一个文本框的内容…",
    "user": "Sentence: {sentence}\nSelected text: {text}"
  },
  "sentence": {
    "name": "划句 · 通顺翻译",
    "kind": "sentence",
    "system": "…设置页第二个文本框的内容…",
    "user": "{text}"
  }
}
```

- 设置页只编辑 `system`；`user` 是固定的传输信封，负责把 `{sentence}` / `{text}` 交给模型。
- `kind` 只是展示用元数据，改它不会改变路由。
- JSON 解析失败或槽位缺失时一律回退内置模板，翻译仍然可用。

## 默认模板 A：划词（`word`）

设置页第一个文本框（对应 `word.system`）：

```text
You are a precise bilingual lexicographer.

Translate the selected text into {targetLang}. You are given the sentence it
appears in - use it ONLY to disambiguate word sense, part of speech and
collocation. Do not translate or paraphrase the sentence itself.

Always output exactly three lines, each on its own line:
<meaning in {targetLang}>（<part of speech>）, e.g. 减轻（v.）
美式音标：/<General American IPA>/
英式音标：/<British RP IPA>/

A token with no whitespace is a single word, and a proper noun is still a
single word: a person's name ("Thoreau"), a place name ("Walden"), a work
title, a brand or product ("iPhone"), an organization, or a mixed-case name all
count. A full personal or place name made of several words also uses this
shape. For a name, line 1 is the accepted translation or transliteration; for a
multi-word name, give one transcription covering the whole name.

Never skip a phonetic line because the token is a name, a brand or a product;
never decide that a transcription is unnecessary. If you are unsure, give your
best broad IPA. If both accents are identical, repeat the same transcription.
Each phonetic line must contain a transcription between slashes.

Final check: the answer must be exactly three lines and contain both 音标
labels; add any missing line before answering. Output plain text only: no
Markdown, no bullet points, no preamble, no extra commentary.
```

插件自动附加的 user 消息（`word.user`，设置页不暴露）：

```text
Sentence: {sentence}
Selected text: {text}
```

## 默认模板 B：划句（`sentence`）

设置页第二个文本框（对应 `sentence.system`）：

```text
You are a precise academic translator.

Translate the text into {targetLang}. The text is already a complete sentence
or a passage, so do not explain and do not add notes - just deliver a faithful,
readable translation.

Rules:
1. Preserve terminology, numbers, formulas, citation markers and proper nouns.
2. Keep the original sentence order; do not merge or split sentences.
3. Output plain text only, never Markdown headings or bullet lists.
4. If the text is already in {targetLang}, output it unchanged.
```

插件自动附加的 user 消息（`sentence.user`）：

```text
{text}
```

对照着看就很清楚：**A 固定三行「词义 + 词性 / 美式音标 / 英式音标」（人名、地名、品牌名同样适用），B 产出一段可直接引用的译文。**
这就是把提示词按选区类型分开的意义——同一套模板无法同时把两件事做好。

## 自定义示例

### 划词：术语速查

粘到 **划词 · 语境辨析** 文本框（划选文本和所在句会自动附在 user 消息末尾，这里不用再写
`{text}` / `{sentence}`）：

```text
目标语言：{targetLang}

请给出：
1) 该词在上下文中的准确译法；
2) 词性与常见搭配；
3) 若为术语，给出该文献语境下的解释（不超过 20 字）。
```

### 划句：直译

粘到 **划句 · 通顺翻译** 文本框：

```text
把附带的文本直译为 {targetLang}，保留句序与术语，不要润色、不要解释。
```

### 划词：只给中文、不要音标

```text
把选中的词语译成 {targetLang}。只用一行输出，格式为「释义（词性）」。
不要输出音标、例句或任何解释。
```

## 高级：直接改 JSON

需要在同一次请求里带上文献标题、或想换掉 `user` 信封时，可以在 `about:config` 中直接编辑
`extensions.zotero.sense-lingo.promptProfiles`。注意：

- 之后在设置页保存模板时，`user` 字段会被保留，`system` 会以文本框内容为准；
- 点「恢复内置默认模板」会清空整个 pref，自定义的 `user` 也随之丢失；
- 两个槽位之外的键会被忽略（旧版本的预设不会被静默启用）。

## 排错的三个信号

| 现象                         | 含义                                                       |
| ---------------------------- | ---------------------------------------------------------- |
| 面板模板名带「回退」说明     | `promptProfileWord` / `promptProfileSentence` 指向了空槽位 |
| 文本框清空后译文恢复默认风格 | 这是预期行为：留空即用内置模板                             |
| 变量没被替换                 | 变量名拼错，或该变量在当前模式下按约定为空串               |
