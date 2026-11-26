# Reader popup
popup-translate = 翻译
popup-translate-title = 结合所在句子，用 AI 翻译选中的词或句子
popup-cache-hint = 来自本地缓存

# Result panel
panel-kind-word = 词
panel-kind-sentence = 句
panel-loading = 翻译中…
panel-no-context = 未取到上下文（该 PDF 可能没有文本层）
panel-context-truncated = 上下文已截断
panel-profile-label = 模板
panel-profile-fallback = 指定的提示词模板不存在，已回退到内置模板
panel-btn-close = 关闭
panel-btn-copy = 复制
panel-btn-switch-word = 按"词"重译
panel-btn-switch-sentence = 按"句"重译
panel-btn-edit-prompt = 改提示词
panel-btn-retry = 重译
panel-cache-meta = 缓存 · { $age }
cache-age-minutes = { $count } 分钟前
cache-age-hours = { $count } 小时前
cache-age-days = { $count } 天前

# Preprocessing
menu-preprocess = 预翻译本书（Sense Lingo）
menu-stop = 停止预翻译
prefetch-headline = Sense Lingo 预翻译
prefetch-progress = 代表句已写入 { $done } / { $total }
prefetch-confirm = 本书预计采样 { $entries } 条代表句，约 { $requests } 次请求；这不覆盖每次词语出现。继续？
prefetch-summary = 代表句采样完成：已写入 { $done } / { $total }，失败 { $failed }
prefetch-paused-error = 已暂停：{ $reason }。可把「并发请求数」调成 1、每批条数调小后再次触发，会接着已完成的部分继续。
prefetch-need-context = 请先在设置中开启「划词时带出所在句子」，否则缓存无法命中。
prefetch-need-provider = 预处理服务商尚未配置：请在设置中填写它的 API Key，或改为跟随翻译服务商。
prefetch-not-epub = 请选择一个 EPUB 附件。
prefetch-no-text = 无法读取该 EPUB 的正文。
prefetch-no-entries = 没有从该 EPUB 中提取到可预翻译的单词。
prefetch-no-db = 本地缓存数据库不可用，已跳过预翻译。

# Errors
error-generic = 翻译失败，请稍后重试。
error-no-key = 尚未配置 API Key。请到 设置 → Sense Lingo 填写。
error-no-selection = 没有取到选中的文本，请重新划词。
error-unsupported-selection = 选中的是标点或目标语言文本，请重新选择原文单词。
error-timeout = 请求超时。可在设置中调大超时时间，或换一个更快的模型。
error-auth = 认证失败（401/403）。请检查 API Key 是否正确、是否有该模型的权限。
error-network = 网络请求失败。请检查网络或代理设置。
error-parse = 模型返回了无法解析的内容，请重试。
error-http = 请求失败（HTTP { $status }）：{ $detail }
