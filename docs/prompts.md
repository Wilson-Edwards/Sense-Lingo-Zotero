# 提示词自定义

[← 中文 README](../README.zh-CN.md) · [English README](../README.md)

本站唯一的「魔法」就在这里：**划词和划句各有一组完全独立的提示词，每组可以保存多套并随时切换**。

设置页的「提示词模板」区域分成两组（「划词模板」「划句模板」），每组结构相同：

| 控件       | 作用                                                                      |
| ---------- | ------------------------------------------------------------------------- |
| 下拉框     | 选择该类型**当前使用**的模板，选中即写入路由 pref，下次翻译立刻生效       |
| 新建       | 以内置模板为起点添加一套（id 自动生成，如 `word-2`）                      |
| 复制       | 复制当前模板，名称追加「（副本）」                                        |
| 删除       | 删除自定义模板；内置 `word` / `sentence` 受保护，只能改写                 |
| 名称       | 模板名，显示在结果面板顶部和面板的模板下拉框里                            |
| 多行文本框 | 该模板的 **system** 提示词，直接编辑即可，**换行原样保留**（不用写 `\n`） |

- 每组的内置模板是兜底项：删不掉、可改写，文本框留空即恢复内置内容。
- 划选的文本与上下文由插件自动附在 user 消息里，模板中不必再手写一遍。
- 两组互不影响：只改划词模板，划句行为完全不变，反之亦然。
- 快捷键结果面板底部的模板下拉框可以**临时**换用同类型的另一套模板并立即重译，
  不修改默认设置，适合「这次想要直译 / 术语速查」。

## 路由规则

```
profileId = (kind === "word") ? promptProfileWord : promptProfileSentence
```

| 选区类型   | 判定条件（默认阈值）                      | 使用的模板                                            |
| ---------- | ----------------------------------------- | ----------------------------------------------------- |
| `word`     | 词数 ≤ 3、无句末标点、≤ 40 字符、非长中文 | `promptProfileWord` 指向的模板（默认 `word`）         |
| `sentence` | 其余情况                                  | `promptProfileSentence` 指向的模板（默认 `sentence`） |

完整判定顺序见 [工作原理](how-it-works.md)。

- 两个路由 pref 只存 **id**，模板内容都在 `promptProfiles` 里；在设置页切换下拉框就是改 id。
- 路由 id 指向不存在的模板（例如刚被删除）时，先回退到同类型的下一套模板，再回退内置模板；
  面板模板名会带说明（悬停可见），日志里写一条 `warn`。绝不静默失败。
- 模板库只有内置模板、且内容与内置一致时，`promptProfiles` 存为空串，方便以后升级默认模板；
  一旦自定义（含新增模板、改名）才写入 JSON。

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

`extensions.zotero.sense-lingo.promptProfiles` 是一个 JSON 字符串，存放整个提示词库：

```json
{
  "word": {
    "name": "划词 · 语境辨析",
    "kind": "word",
    "system": "…「划词模板」里内置模板的 system…",
    "user": "Sentence: {sentence}\nSelected text: {text}"
  },
  "word-2": {
    "name": "术语速查",
    "kind": "word",
    "system": "…自定义模板的 system…",
    "user": "Sentence: {sentence}\nSelected text: {text}"
  },
  "sentence": {
    "name": "划句 · 通顺翻译",
    "kind": "sentence",
    "system": "…「划句模板」里内置模板的 system…",
    "user": "{text}"
  },
  "sentence-2": {
    "name": "直译",
    "kind": "sentence",
    "system": "…自定义模板的 system…",
    "user": "{text}"
  }
}
```

- 设置页编辑 `name` / `system`；`user` 是固定的传输信封，负责把 `{sentence}` / `{text}` 交给模型，
  新模板继承该类型的默认信封。
- id 由插件生成（`word-2`、`sentence-3`…），改名不会改 id，所以路由 pref 永远指向同一套模板。
- `kind` 只用于分组展示与设置页列表，改它不会改变路由；缺失时按 id 前缀推断（`sentence*` → 句，其余 → 词）。
- 旧版本的两槽位 JSON 会被原样读出；现在额外的 id 不再被丢弃，升级不会丢自定义模板。
- JSON 解析失败或槽位缺失时一律回退内置模板，翻译仍然可用。

## 默认模板 A：划词（`word`）

「划词模板」组里内置模板（`word`）的 system：

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

「划句模板」组里内置模板（`sentence`）的 system：

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

在「划词模板」组里点「新建」，把下面内容粘进文本框（划选文本和所在句会自动附在 user 消息末尾，
这里不用再写 `{text}` / `{sentence}`）：

```text
目标语言：{targetLang}

请给出：
1) 该词在上下文中的准确译法；
2) 词性与常见搭配；
3) 若为术语，给出该文献语境下的解释（不超过 20 字）。
```

### 划句：直译

在「划句模板」组里点「新建」，粘到文本框：

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

- 也可以只手写一套自定义模板：id 任意（建议 `word-*` / `sentence-*`），`system` 必填，
  `kind` 写 `word` 或 `sentence`（不写则按 id 前缀推断），`user` 省略时用该类型的默认信封；
- 之后在设置页保存模板时，`user` 字段会被保留，`name` / `system` 会以界面内容为准；
- 点「恢复内置默认模板（删除所有自定义模板）」会清空整个 pref，自定义模板与 `user` 随之丢失；
- 把 `promptProfileWord` / `promptProfileSentence` 指向自定义 id，即可让它成为该类型的默认模板；
- 想临时试用另一套模板，不必改默认值：快捷键面板的模板下拉框只影响本次。

## 排错的三个信号

| 现象                         | 含义                                                          |
| ---------------------------- | ------------------------------------------------------------- |
| 面板模板名带「回退」说明     | 路由 id 指向的模板已被删除；已回退到同类型的第一套 / 内置模板 |
| 文本框清空后译文恢复默认风格 | 这是预期行为：留空即恢复该类型的内置模板                      |
| 变量没被替换                 | 变量名拼错，或该变量在当前模式下按约定为空串                  |
