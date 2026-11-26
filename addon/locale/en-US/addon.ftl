# Reader popup
popup-translate = Translate
popup-translate-title = Translate the selection with AI, using its sentence as context
popup-cache-hint = Served from the local cache
popup-refresh = Refresh
popup-refresh-title = Request a new translation and update the local cache

# Result panel
panel-kind-word = WORD
panel-kind-sentence = SENTENCE
panel-loading = Translating…
panel-no-context = No context found (this PDF may have no text layer)
panel-context-truncated = context truncated
panel-profile-label = Prompt
panel-profile-fallback = Prompt profile not found, falling back to the built-in one
panel-btn-close = Close
panel-btn-copy = Copy
panel-btn-switch-word = Retry as word
panel-btn-switch-sentence = Retry as sentence
panel-btn-edit-prompt = Edit prompt
panel-btn-retry = Retry
panel-cache-meta = Cache · { $age }
cache-age-minutes = { $count } min ago
cache-age-hours = { $count } h ago
cache-age-days = { $count } d ago

# Preprocessing
menu-preprocess = Pre-translate this book (Sense Lingo)
menu-stop = Stop pre-translation
prefetch-headline = Sense Lingo pre-translation
prefetch-progress = Representative sentences written { $done } / { $total }
prefetch-confirm = Sample about { $entries } representative sentences in roughly { $requests } requests? This does not cover every word occurrence.
prefetch-summary = Representative sample complete: { $done } / { $total } written, { $failed } failed
prefetch-paused-error = Paused: { $reason }. Lower "concurrent requests" to 1 (or reduce the batch size) and run it again; finished entries are skipped.
prefetch-need-context = Enable "include the containing sentence" first; otherwise the cache can never match.
prefetch-need-provider = The pre-translation provider is not configured: set its API key in settings, or switch it to follow the translation provider.
prefetch-not-epub = Select an EPUB attachment.
prefetch-no-text = Could not read this EPUB's text.
prefetch-no-entries = No word eligible for pre-translation was found in this EPUB.
prefetch-no-db = The local cache database is unavailable; pre-translation was skipped.

# Errors
error-generic = Translation failed. Please try again.
error-no-key = No API key yet. Set it in Settings → Sense Lingo.
error-no-selection = Nothing selected. Please select the text again.
error-unsupported-selection = The selection is punctuation or already in the target language. Select a source-language word.
error-timeout = Request timed out. Raise the timeout in settings or use a faster model.
error-auth = Authentication failed (401/403). Check the API key and model permissions.
error-network = Network request failed. Check your connection or proxy.
error-parse = The model returned an unparsable response. Please retry.
error-http = Request failed (HTTP { $status }): { $detail }
