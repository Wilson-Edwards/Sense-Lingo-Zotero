# 配置项参考

[← 中文 README](../README.zh-CN.md) · [English README](../README.md)

所有设置都保存在 Zotero 的偏好（prefs）里，前缀是 `extensions.zotero.sense-lingo.`。默认值写在
[`addon/prefs.js`](../addon/prefs.js) 中，构建时由 `zotero-plugin-scaffold` 自动加上前缀。

- 常规项请走设置页：`编辑 / Edit` → `设置 / Settings` → `Sense Lingo`。
- 设置页没有暴露的项，可在 Zotero 的 `高级 → 配置编辑器（about:config）` 里搜索
  `extensions.zotero.sense-lingo.` 后修改。

> Firefox 的 pref 只支持整数 / 布尔 / 字符串三种类型，所以 `temperature` 以字符串存储、
> `providerConfigs` 与 `promptProfiles` 以 JSON 字符串存储。

## 设置页分区

| 分区       | 内容                                                                 |
| ---------- | -------------------------------------------------------------------- |
| 服务商     | 服务商预设、API Key、接口地址、模型、温度、最大 tokens               |
| 选区类型   | 判定方式（自动 / 一律按词 / 一律按句）、判为「词」的最大词数与字符数 |
| 上下文     | 划词时带出所在句、划句时带出前后各一句、单句长度上限                 |
| 提示词模板 | 「划词 · 语境辨析」「划句 · 通顺翻译」两个文本框 + 恢复内置默认模板  |
| 界面与高级 | 弹窗按钮、自动翻译、快捷键、弹窗字号、调试日志、请求超时             |

## 完整配置表

| 键                         | 类型         | 默认值     | 设置页 | 说明                                                                                                |
| -------------------------- | ------------ | ---------- | ------ | --------------------------------------------------------------------------------------------------- |
| `provider`                 | string       | `openai`   | ✅     | 服务商预设：`openai` / `deepseek` / `custom`                                                        |
| `apiKey`                   | string       | `""`       | ✅     | API Key。以**明文**保存在 prefs 中，见 [隐私与安全](../README.zh-CN.md#隐私与安全)                  |
| `baseURL`                  | string       | `""`       | ✅     | 接口地址；留空使用预设。只写主机名时自动补 `/v1`，末尾斜杠会被去掉                                  |
| `model`                    | string       | `""`       | ✅     | 模型名，如 `gpt-4o-mini` / `deepseek-chat`；留空使用预设                                            |
| `providerConfigs`          | string(JSON) | `""`       | —      | 按服务商分别保存的 `apiKey` / `baseURL` / `model`，切换预设时自动写入 / 读出                        |
| `temperature`              | string       | `"0.3"`    | ✅     | 越低越稳定，翻译建议 0～0.5；读取时钳制在 0～2                                                      |
| `maxTokens`                | number       | `1024`     | ✅     | 单次回复上限                                                                                        |
| `targetLang`               | string       | `zh-CN`    | —      | 目标语言，原样替换进提示词的 `{targetLang}`                                                         |
| `sourceLang`               | string       | `auto`     | —      | 源语言，只用于 `{sourceLang}` 变量；默认模板不引用它，由模型自行判断                                |
| `selectionKindMode`        | string       | `auto`     | ✅     | 选区类型判定：`auto` 自动 / `alwaysWord` 一律按词 / `alwaysSentence` 一律按句                       |
| `wordMaxWords`             | number       | `3`        | ✅     | 判为「词」的最大词数，超出按句处理                                                                  |
| `wordMaxChars`             | number       | `40`       | ✅     | 判为「词」的最大字符数，超出按句处理                                                                |
| `useContext`               | boolean      | `true`     | ✅     | **仅划词**：是否带出所在句；关闭后等同词典式直译                                                    |
| `sentenceContextNeighbors` | boolean      | `false`    | ✅     | **仅划句**：是否取前后各一句填入 `{prevSentence}` / `{nextSentence}`                                |
| `maxSentenceChars`         | number       | `400`      | ✅     | 单句上下文长度上限，超出截断并在面板提示                                                            |
| `promptProfileWord`        | string       | `word`     | —      | 划词路由 id（兼容旧配置；失效时回退内置 `word` 并告警）                                             |
| `promptProfileSentence`    | string       | `sentence` | —      | 划句路由 id（同上，回退内置 `sentence`）                                                            |
| `promptProfiles`           | string(JSON) | `""`       | ✅\*   | 提示词模板集合；设置页两个文本框对应 `word` / `sentence` 槽位的 `system`，详见 [提示词](prompts.md) |
| `showInPopup`              | boolean      | `true`     | ✅     | 是否在划词弹窗中注入「翻译」按钮                                                                    |
| `autoTranslate`            | boolean      | `false`    | ✅     | 选中文本后自动翻译，译文直接显示在弹窗内；开启后不再显示按钮；未配置 API Key 时静默跳过             |
| `shortcutEnabled`          | boolean      | `true`     | ✅     | 是否启用快捷键 `Ctrl/⌘ + Shift + T`                                                                 |
| `popupFontSize`            | number       | `12`       | ✅     | 弹窗内译文字号（px，限制 8–32）；弹窗宽度随字号等比放宽                                             |
| `requestTimeoutMs`         | number       | `30000`    | ✅     | 请求超时（毫秒）；超时会提示重试而不是静默失败                                                      |
| `debug`                    | boolean      | `false`    | ✅     | 输出详细日志到 Zotero `帮助 → 调试输出`                                                             |

\* `promptProfiles` 不直接呈现为输入框，而是由设置页的两个模板文本框读写。

## 服务商预设

| provider   | baseURL                       | 默认 model      |
| ---------- | ----------------------------- | --------------- |
| `openai`   | `https://api.openai.com/v1`   | `gpt-4o-mini`   |
| `deepseek` | `https://api.deepseek.com/v1` | `deepseek-chat` |
| `custom`   | 用户填写                      | 用户填写        |

- `apiKey` 是必填项，`custom` 也不例外。
- `custom` 只要兼容 OpenAI 的 `POST {baseURL}/chat/completions` 即可（自建网关、Ollama、LM Studio 等）。
- 接口地址留空时使用预设；只填主机名（如 `https://api.example.com`）会自动补成
  `https://api.example.com/v1`，地址里已含路径则原样使用。

## 服务商之间的隔离

设置页切换预设时，会先把当前填写的 `apiKey` / `baseURL` / `model` 存入 `providerConfigs`，
再载入目标服务商上一次保存的那一份：

```json
{
  "openai": { "apiKey": "sk-...", "baseURL": "", "model": "" },
  "deepseek": { "apiKey": "sk-...", "baseURL": "", "model": "deepseek-chat" }
}
```

- 目标服务商从未配置过时，三个字段会清空，即回落到该预设的默认地址与模型。
- 运行时的生效值始终是扁平的 `provider` / `apiKey` / `baseURL` / `model`，
  `providerConfigs` 只是「每个服务商各自的存档」。
- 因此 OpenAI 与 DeepSeek 的 Key、地址、模型互不覆盖，来回切换后仍是各自的值。

## 常用改法

### 改成其它目标语言

`targetLang` 目前没有出现在设置页，可在 `about:config` 里改：

```text
extensions.zotero.sense-lingo.targetLang = English
```

该值会原样替换进提示词，所以写语言名（`English`、`Japanese`）或语言标签（`en-US`、`ja-JP`）都可以。

### 用本地模型

1. 服务商预设选 `Custom`；
2. 接口地址填本地服务的 OpenAI 兼容端点，例如 `http://127.0.0.1:11434/v1`；
3. 模型填本地模型名，如 `qwen2.5:7b`。

这样论文内容不会离开本机。

### 其它项

改 `about:config` 里对应的键即可，无需重启；下一次翻译就会读到新值。
