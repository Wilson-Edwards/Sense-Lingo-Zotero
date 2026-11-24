pref-title = Sense Lingo

pref-head-provider = Provider
pref-provider = Preset
pref-provider-hint = Each provider keeps its own API key, base URL and model; switching presets won't overwrite them
pref-api-key = API key
pref-base-url = Base URL (blank = preset)
pref-model = Model
pref-model-custom = Custom model
pref-model-hint = Pick one from the list above; a model the list lacks can be typed under "Custom model". Leaving it blank uses the preset default.
pref-model-use-preset = Use preset ({ $model })
pref-model-fetch = Fetch models
pref-model-status-loading = Fetching models…
pref-model-status-loaded = Loaded { $count } model(s)
pref-model-status-failed = Could not fetch models: { $error }
pref-model-status-need-key = Enter the API key first
pref-temperature = Temperature
pref-max-tokens = Max tokens
pref-disable-thinking = Disable thinking (skip the reasoning phase — faster and cheaper; on by default)
pref-disable-thinking-unsupported = This provider does not support the switch (only ClinePass is verified); switch back to ClinePass to use it.

pref-head-kind = Selection kind
pref-kind-mode = Detection mode
pref-kind-auto = Auto detect
pref-kind-word = Always word
pref-kind-sentence = Always sentence
pref-word-max-words = Max words for "word"
pref-word-max-chars = Max characters

pref-head-context = Context
pref-use-context = Include the containing sentence for words
pref-context-neighbors = Include neighbouring sentences for sentences
pref-max-sentence-chars = Max context sentence length

pref-head-prompts = Prompt templates
pref-prompt-hint = Each selection kind can keep several prompts; the preset selected above is the one in use. "New" starts from the built-in prompt, "Copy" duplicates the current one. Line breaks are preserved and variables such as {"{"}text{"}"}, {"{"}sentence{"}"} and {"{"}targetLang{"}"} are substituted; the selected text is appended automatically, and a blank box restores the built-in prompt.
pref-prompt-new = New
pref-prompt-copy = Copy
pref-prompt-delete = Delete
pref-prompt-name = Name
pref-prompt-copy-suffix = (copy)
pref-word-template = Word prompt
pref-sentence-template = Sentence prompt
pref-reset-profiles = Restore built-in templates (drops every custom prompt)
pref-profile-empty-reset = Template was empty; restored the built-in default

pref-head-ui = Interface & advanced
pref-show-in-popup = Show the translate button in the selection popup
pref-auto-translate = Translate automatically when text is selected (no button click)
pref-shortcut = Enable Ctrl/⌘ + Shift + T
pref-popup-font-size = Selection popup translation font size (px, 8–32)
pref-stream = Stream the response and show text as it is generated
pref-debug = Verbose logs (Help → Debug Output Logging)
pref-timeout = Request timeout (ms)

pref-help = { $name } build { $version } · { $time }
