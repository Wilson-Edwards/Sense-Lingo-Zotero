pref-title = Sense Lingo

pref-head-provider = 服务商
pref-provider = 服务商预设
pref-provider-hint = 每个服务商单独保存 API Key、接口地址与模型，切换预设不会互相覆盖
pref-api-key = API Key
pref-base-url = 接口地址（留空使用预设）
pref-model = 模型（留空使用预设）
pref-temperature = 温度
pref-max-tokens = 最大 tokens

pref-head-kind = 选区类型
pref-kind-mode = 判定方式
pref-kind-auto = 自动判定
pref-kind-word = 一律按"词"
pref-kind-sentence = 一律按"句"
pref-word-max-words = 判为"词"的最大词数
pref-word-max-chars = 最大字符数

pref-head-context = 上下文
pref-use-context = 划词时带出所在句子（关闭后为纯词义翻译）
pref-context-neighbors = 划句时带出前后各一句
pref-max-sentence-chars = 单句上下文长度上限

pref-head-prompts = 提示词模板
pref-prompt-hint = 直接编辑系统提示词，换行会原样保留；支持 {"{"}text{"}"}、{"{"}sentence{"}"}、{"{"}targetLang{"}"} 等变量。划选的文本会自动附在消息末尾，留空则使用内置模板。
pref-word-template = 划词 · 语境辨析
pref-sentence-template = 划句 · 通顺翻译
pref-reset-profiles = 恢复内置默认模板
pref-profile-empty-reset = 模板为空，已恢复内置默认模板

pref-head-ui = 界面与高级
pref-show-in-popup = 在划词弹窗中显示翻译按钮
pref-auto-translate = 选中文本后自动翻译（无需点击按钮）
pref-shortcut = 启用快捷键 Ctrl/⌘ + Shift + T
pref-popup-font-size = 划词弹窗内译文字号（px，8–32）
pref-debug = 输出调试日志（帮助 → 调试输出）
pref-timeout = 请求超时（毫秒）

pref-help = { $name } 构建 { $version } · { $time }
