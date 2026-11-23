# 开发指南

[← 中文 README](../README.zh-CN.md) · [English README](../README.md)

## 环境要求

- Node.js ≥ 22.12（Vitest 5 / ESLint 10 的要求；推荐 24 LTS），npm ≥ 10
- Zotero 7（建议稳定版与 beta 都测一遍）
- 一个用于调试的 Zotero 配置目录（scaffold 可自动创建）

## 常用命令

```bash
git clone https://github.com/linqingxiao/sense-lingo-zotero.git
cd sense-lingo-zotero
npm install
```

| 命令                  | 作用                                                         |
| --------------------- | ------------------------------------------------------------ |
| `npm start`           | 启动开发实例（`zotero-plugin serve`），代码变更后热重载      |
| `npm run build`       | 打包 + 类型检查，产出 `.scaffold/build/sense-lingo.xpi`      |
| `npm run typecheck`   | `tsc --noEmit`                                               |
| `npm run lint:check`  | Prettier 格式检查 + ESLint                                   |
| `npm run lint:fix`    | 自动格式化并修复 lint 问题                                   |
| `npm test`            | Vitest 单元测试（纯函数，不启动 Zotero）                     |
| `npm run test:watch`  | Vitest watch 模式                                            |
| `npm run test:zotero` | 在真实 Zotero 中跑集成测试（需要 `.env` 里配置 Zotero 路径） |
| `npm run release`     | 用 scaffold 发布 Release（需要 GitHub 凭据，见下）           |

### `npm start` 的 `.env`

```bash
cp .env.example .env
```

| 变量                            | 说明                                                                              |
| ------------------------------- | --------------------------------------------------------------------------------- |
| `ZOTERO_PLUGIN_ZOTERO_BIN_PATH` | Zotero 可执行文件路径；macOS 例：`/Applications/Zotero.app/Contents/MacOS/zotero` |
| `ZOTERO_PLUGIN_PROFILE_PATH`    | 可选，开发用 profile 目录；留空由 scaffold 创建                                   |
| `ZOTERO_PLUGIN_DATA_DIR`        | 可选，开发 profile 使用的数据目录                                                 |

## 调试

- **日志**：`帮助 → 调试输出`，过滤 `Sense Lingo` 前缀。设置里打开 `debug` 会输出更详细的信息
  （命中哪一层文本来源、匹配次数、是否截断等）。
- **附加调试器**：`npm start` 会带 `--jsdebugger` 启动 Zotero，可用 Firefox 调试器或
  `about:debugging` 附加；端口见启动日志。
- **改哪需要重启**：
  - `src/**` 改动 → 热重载；
  - `addon/manifest.json`、`addon/prefs.js`、locale、xhtml 改动 → 需要重启 Zotero。

## 测试

`npm test` 用 [Vitest](https://vitest.dev/) 直接跑纯函数，13 个文件、168 个用例：

| 测试文件                      | 用例 | 覆盖内容                                                                |
| ----------------------------- | ---- | ----------------------------------------------------------------------- |
| `sentence.test.ts`            | 28   | 分句、缩写、断词、空白不敏感匹配、指纹消歧、前后句、截断                |
| `prompt.test.ts`              | 33   | 模板解析、路由、回退、默认模板判定、变量渲染                            |
| `selectionKind.test.ts`       | 19   | 1/3/4 词边界、标点、缩写、跨行、中英混排、纯数字、强制模式              |
| `chatCompletion.test.ts`      | 12   | 请求构造、地址归一、响应解析、错误归一、服务商预设                      |
| `chatStream.test.ts`          | 14   | SSE 增量解析、跨包拼接、`[DONE]`、JSON 回退、流内错误、不可读 body 降级 |
| `client.test.ts`              | 12   | 端点拼接、响应 / 流式分片解析                                           |
| `llmRuntime.test.ts`          | 7    | `fetch` / `AbortController` / `TextDecoder` 的作用域选择                |
| `popupTranslation.test.ts`    | 10   | 请求共享、60 秒缓存、失败不缓存                                         |
| `popupStream.test.ts`         | 6    | 弹窗重渲染时的增量回放、脱离 DOM 的槽位回收                             |
| `popupFontSize.test.ts`       | 9    | 字号钳制、弹窗宽度                                                      |
| `providerCredentials.test.ts` | 8    | 服务商配置的存取与切换隔离                                              |
| `format.test.ts`              | 6    | 音标标签拆行                                                            |
| `selectionAnchor.test.ts`     | 4    | 锚点块文本与指纹提取                                                    |

不适合单测的部分（真实阅读器 UI、端到端）靠人工回归：

| 层             | 方式 | 检查点                                                        |
| -------------- | ---- | ------------------------------------------------------------- |
| Zotero UI 注入 | 手工 | 弹窗按钮出现、译文内联、字号生效、弹窗重渲染不重复请求        |
| 流式显示       | 手工 | 弹窗 / 结果面板逐字增长；弹窗重渲染后仍继续增长而不是跳到全文 |
| 端到端         | 手工 | 真实 API Key 下分别跑「划词」「划句」以及 EPUB 的一节         |

流式相关的问题可以先用调试日志定位：打开「设置 → 界面与高级 → 调试日志」后，每次请求会打印
`request <provider> <model> stream|buffered via <scope>` 与 `stream finished N chunk(s), M char(s)`；
如果出现 `WARN streaming unavailable`，说明拿到的是不可读的响应体，问题在传输层而不是 UI。

## 项目结构

````text
.
├── addon/                          # 静态资源（打包进 xpi）
│   ├── manifest.json               # 插件元信息、兼容版本
│   ├── bootstrap.js                # Zotero 7 bootstrap 入口
│   ├── prefs.js                    # 默认偏好设置
│   ├── content/
│   │   ├── preferences.xhtml       # 设置页（XUL + html: 混合片段）
│   │   ├── preferences.js          # 设置页 shim：监听 showing 事件
│   │   └── icons/                  # favicon.png / favicon@0.5x.png
│   └── locale/
│       ├── en-US/ { addon, preferences }.ftl
│       └── zh-CN/ { addon, preferences }.ftl
├── src/
│   ├── index.ts                    # 入口：创建插件实例并挂到 Zotero
│   ├── hooks.ts                    # 生命周期 / 设置页事件分发
│   ├── addon.ts                    # 插件基类与全局状态
│   ├── modules/
│   │   ├── translate.ts            # 主管线：类型 → 上下文 → 提示词 → LLM
│   │   ├── controller.ts           # UI 与管线之间：状态机 + 错误文案
│   │   ├── reader/
│   │   │   ├── selectionPopup.ts   # 划词弹窗：按钮 + 内联译文
│   │   │   ├── popupTranslation.ts # 弹窗请求共享 / 60 秒缓存（纯逻辑）
│   │   │   ├── popupFontSize.ts    # 字号钳制与弹窗宽度（纯逻辑）
│   │   │   ├── selectionKind.ts    # word / sentence 判定（纯函数）
│   │   │   ├── sentence.ts         # 句子定位 + 前后句（纯函数）
│   │   │   ├── textSource.ts       # 附件全文 / EPUB 全文 + 缓存
│   │   │   ├── readerText.ts       # 阅读器文档与嵌套 iframe 文本
│   │   │   ├── selectionAnchor.ts  # 划词瞬间的块文本与指纹
│   │   │   ├── selectionState.ts   # 每个文档最近一次选区
│   │   │   └── shortcuts.ts        # Ctrl/⌘+Shift+T
│   │   ├── llm/
│   │   │   ├── client.ts           # OpenAI 兼容客户端（超时 / 错误码归一）
│   │   │   ├── providers.ts        # openai / deepseek / custom 预设
│   │   │   ├── prompt.ts           # 模板槽位、默认模板、路由与回退
│   │   │   ├── format.ts           # 划词三行格式归一
│   │   │   └── render.ts           # 变量渲染
│   │   └── ui/
│   │       ├── resultPanel.ts      # 阅读器内的译文面板
│   │       └── preferences.ts      # 设置页逻辑与模板保存
│   └── utils/                      # prefs.ts / locale.ts / logger.ts
├── test/                           # Vitest 单元测试
├── typings/global.d.ts             # 全局声明 + PluginPrefsMap
## 构建产物

`npm run build` 在 `.scaffold/build/` 下生成：

| 文件               | 用途                                                         |
| ------------------ | ------------------------------------------------------------ |
| `sense-lingo.xpi`  | 安装包，手动装插件或上传 Release 都用它                      |
| `update.json`      | 正式版更新清单（`updateURL` 指向 Release 里的这个文件）      |
| `update-beta.json` | 预发布版更新清单（版本号带 `-` 时使用）                      |

`zotero-plugin.config.ts` 里的 `updateURL` / `xpiDownloadLink` 都由 `{{owner}}/{{repo}}` 模板生成，
换仓库地址时只需改 `package.json` 的 `homepage` / `repository`。

## 发布 Release

```bash
GITHUB_TOKEN=ghp_xxx npm run release
````

scaffold 会：升版本号 → 提交 `chore(release): vX.Y.Z` → 打 tag → 上传 xpi →
创建/更新 `release` tag 下的 `update.json`。当前仓库**没有 CI workflow**，
如需自动打包与发布，可参考 [zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template)
的 `.github/workflows` 自行补上。

## Zotero 版本兼容

`addon/manifest.json` 里的 `strict_min_version` / `strict_max_version` 是硬上限：

```json
"strict_min_version": "7.0",
"strict_max_version": "11.*"
```

Zotero 每次大版本更新后，把 `strict_max_version` 往前推一位并重新构建，否则会报
「它可能无法与该版本的 Zotero 兼容」。确认打包产物里的真实取值：

```bash
unzip -p .scaffold/build/sense-lingo.xpi manifest.json | grep strict_
```

## 代码约定

- **纯函数优先**：能脱离 DOM 的逻辑都放在 `reader/`、`llm/` 下并配单测；
  `selectionPopup.ts`、`resultPanel.ts` 只做 DOM。
- **不碰 Zotero 私有属性**：优先用 `Zotero.Reader.registerEventListener`、
  `Item.attachmentText` 等公开接口；必须用内部 API 的地方（如 EPUB 解析、
  `_internalReader._primaryView`）都包了 try/catch，失败只降级不抛错。
- **失败要可解释**：所有对模型的失败都归一成 `LlmError` + 本地化文案；
  模板 / 配置损坏时回退默认值并写 `warn`，不静默失败。
- **pref 类型**：pref 只支持 int / bool / string；浮点（如温度）与结构化配置
  （`promptProfiles`、`providerConfigs`）都用字符串存。
- **新增配置项**：同时更新 `addon/prefs.js`、`typings/global.d.ts` 的 `PluginPrefsMap`、
  设置页（`preferences.xhtml` + `ui/preferences.ts` + 两份 `preferences.ftl`）与本仓库文档。

## 已知环境约束

- 根依赖 `typescript` 固定在 **6.x**：`@typescript-eslint` 依赖的 `ts-api-utils`
  尚未兼容 TS 7，升级前请先确认 lint 仍可用。
- 构建目标为 `firefox115`（Zotero 7 的运行时），不要使用更新的 ES 语法。
