# Sense Lingo

**English** · [简体中文](README.zh-CN.md)

> **Context-aware AI word & sentence translation for Zotero 7.** Select a word and Sense Lingo
> explains it _in the sentence where it appears_, with US/UK IPA; select a sentence and it returns a
> clean translation. **Two prompts, two jobs, zero interference.**

<p>
  <img alt="Zotero 7" src="https://img.shields.io/badge/Zotero-7-CC2936?style=flat-square&logo=zotero" />
  <img alt="Version 0.1.0" src="https://img.shields.io/badge/version-0.1.0-blue?style=flat-square" />
  <img alt="License AGPL-3.0" src="https://img.shields.io/badge/license-AGPL--3.0-blue?style=flat-square" />
  <img alt="Tests 168 passing" src="https://img.shields.io/badge/tests-168%20passing-brightgreen?style=flat-square" />
</p>

<!-- Before publishing, add a demo GIF: docs/images/demo.gif
<img src="docs/images/demo.gif" width="720" alt="Selection translation demo" /> -->

[Quick start](#quick-start) · [Usage](#usage) · [Configuration](docs/configuration.md) ·
[Prompts](docs/prompts.md) · [How it works](docs/how-it-works.md) ·
[Development](docs/development.md) · [Troubleshooting](docs/troubleshooting.md)

> Detailed reference docs are currently written in Chinese. The full Chinese README lives
> [here](README.zh-CN.md); translation PRs are welcome.

## Why another translate plugin?

Reading English papers, **translating a single word is often not enough**:

| Common approach                     | Problem                                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Translate only the selected word    | The sentence is lost. `address` means “deal with” in `address the issue`, but “location” in `email address`. |
| Translate the whole paragraph       | Too heavy when all you want is what _this_ word means _here_.                                                |
| Generic selection-translation tools | Treat the selection as the whole input, so the result is often “correct but off-key”.                        |

So the project does exactly one thing: **selection → find the sentence that contains it → send both
to an LLM → get a contextual translation whose prompt you fully control.**

One-line pitch: **the Zotero plugin that actually understands context.**

## See it in action

Take `The results suggest that the proposed method can mitigate the inherent noise.` and select it
two different ways:

| Selection                           | Kind     | Output                                                                                                  |
| ----------------------------------- | -------- | ------------------------------------------------------------------------------------------------------- |
| `mitigate`                          | word     | 减轻（v.）；在此句中指降低…的程度<br>`美式音标：/ˈmɪtɪɡeɪt/`<br>`英式音标：/ˈmɪtɪɡeɪt/`                 |
| `inherent`                          | word     | 固有的（adj.）；句中修饰 noise，指数据自带的噪声<br>`美式音标：/ɪnˈhɛrənt/`<br>`英式音标：/ɪnˈhɪərənt/` |
| `The results suggest that … noise.` | sentence | 结果表明，所提方法能够减轻固有噪声。                                                                    |

The key difference: **for a word, the model explains what it means _in this sentence_; for a
sentence, it only translates.** That is why the two cases get two separate prompts — one template
cannot do both well.

_Default target language is Simplified Chinese (`zh-CN`); see [configuration](docs/configuration.md)
for changing it._

## Features

| Capability                     | What it does                                                                                                                                                                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🔤 Word / sentence translation | Select text in the Zotero PDF / EPUB reader; the translation appears inside the native selection popup, translation only.                                                                                                 |
| 🧩 Context disambiguation      | Words automatically bring their containing sentence; sentences can optionally bring one neighbour on each side.                                                                                                           |
| 🗣 US / UK IPA                  | The word prompt always returns three lines: **meaning** / **US IPA** / **UK IPA**, including people, places, brands and products.                                                                                         |
| 🎯 Two-prompt routing          | Separate templates for “word” (contextual meaning + part of speech) and “sentence” (readable translation).                                                                                                                |
| 🤖 Multiple providers          | Built-in **OpenAI**, **DeepSeek**, **ClinePass** and **Command Code**, plus an “OpenAI compatible” mode for any self-hosted gateway or local model (e.g. Ollama).                                                         |
| ✍️ Fully editable prompts      | Multiple presets per kind, managed (new / copy / delete) and switched in settings; the result panel can try another preset on the spot. Line breaks and `{text}` / `{sentence}` / `{targetLang}` variables are preserved. |
| 🎛️ Configurable model          | Model dropdown plus a custom field, `baseURL`, `temperature`, `max_tokens` and timeout; per-provider credentials never overwrite each other.                                                                              |
| 🚫 Disable thinking            | On by default: requests carry `reasoning: { enabled: false }` to skip the reasoning phase (Qwen / Kimi measurably drop to zero thinking tokens — faster and cheaper); a model that mandates reasoning is retried.         |
| ⚡ Shortcut result panel       | `Ctrl/⌘ + Shift + T`: detected kind, template name, matched sentence, model · latency; flip kind, tweak the user message, copy.                                                                                           |
| 🪄 Auto-translate              | Translate as soon as text is selected; off by default to avoid accidental cost.                                                                                                                                           |
| 🌊 Streaming                   | On by default; the translation appears while it is generated. Can be turned off; falls back automatically with idle-based timeout.                                                                                        |
| 🔁 Correctable kind            | One click to switch between “word” and “sentence” and re-translate; applies to this request only.                                                                                                                         |
| 🌐 Bilingual UI                | Fluent-localized strings, shipping `zh-CN` and `en-US`.                                                                                                                                                                   |

## Quick start

### 1. Install the plugin

**From a release** (once published):

1. Download `sense-lingo.xpi` from [Releases](https://github.com/linqingxiao/sense-lingo-zotero/releases);
2. In Zotero: `Tools` → `Plugins` → gear icon → `Install Plugin From File…`;
3. Pick the xpi and restart Zotero.

**From source** (recommended until a release exists):

```bash
npm install
npm run build        # → .scaffold/build/sense-lingo.xpi
```

Install that xpi through the same menu. Requires **Zotero 7.0 – 11.x**; see
`strict_min_version` / `strict_max_version` in `addon/manifest.json`.

> Won't install, or Zotero says it may be incompatible? Your Zotero is probably newer than
> `strict_max_version` — see
> [troubleshooting](docs/troubleshooting.md#zotero-升级后装不上).

### 2. Add an API key

Open `Edit` → `Settings` → `Sense Lingo`:

| Field           | What to enter                                                                       |
| --------------- | ----------------------------------------------------------------------------------- |
| Provider preset | `OpenAI` / `DeepSeek` / `ClinePass` / `Command Code` / `Custom (OpenAI compatible)` |
| API Key         | The key for that provider (required)                                                |
| Base URL, Model | Leave blank to use the preset; fill them in for a custom endpoint                   |

| provider      | Default base URL                         | Default model                    |
| ------------- | ---------------------------------------- | -------------------------------- |
| `openai`      | `https://api.openai.com/v1`              | `gpt-4o-mini`                    |
| `deepseek`    | `https://api.deepseek.com/v1`            | `deepseek-chat`                  |
| `clinepass`   | `https://api.cline.bot/api/v1`           | `cline-pass/deepseek-v4.1-flash` |
| `commandcode` | `https://api.commandcode.ai/provider/v1` | `deepseek/deepseek-v4-flash`     |

Credentials (key / URL / model) are stored **per provider**, so switching back and forth never
overwrites the other one. For a local model, choose `Custom` and point the base URL at a local
OpenAI-compatible endpoint. The model field is a **dropdown** that is already filled for the
current provider when the pane opens, so a model can just be picked. ClinePass lists the ten
slugs baked into the preset (no fetch needed); its first entry, "Use preset", is the same as
leaving `model` blank, and a model the list lacks goes in **Custom model**. **Fetch models** only
refreshes the list once: ClinePass has no catalogue of its own (`/api/v1/cline-pass/models` is a
404 and the shared `/api/v1/models` lists no `cline-pass/...` alias), so the refresh falls back
to the preset list. Its requests automatically carry `X-Response-Format: openai`.
Command Code lists its `provider/model` catalogue at `GET /models`, so **Fetch models** fills the
dropdown with every chat-completions model that key can call (its `/messages`-only Claude ids are
filtered out).

### 3. Translate something

1. Open any PDF or EPUB attachment;
2. Select a **word** or a **whole sentence** — the kind is detected automatically;
3. Click **Translate** in the popup; the translation is rendered inside the popup.
   Turn on auto-translate to skip the click.

If no API key is configured yet, the popup tells you to fill it in under Settings.

## Usage

### Selection popup

- The popup gets a **Translate** button; the result appears inline, **translation only** — no extra
  panel in the corner.
- A word selection returns exactly three lines: **meaning (with part of speech)**, **US IPA**,
  **UK IPA** — people, places, brands and products included. If a model glues the labels onto one
  line, they are split before display.
- With **auto-translate** enabled, selecting text translates immediately and the button is hidden.
  When no API key is configured it stays silent instead of popping an error on every selection.
- Popup font size is configurable (8–32 px); the popup widens proportionally so the number of
  characters per line stays roughly the same.
- Translations are **inline**: if the popup is closed before the response arrives, the result has
  nowhere to go. Use the shortcut panel if you need to keep it.

### Shortcut and result panel

Press `Ctrl/⌘ + Shift + T` for the full result panel:

| Area   | Content                                                                                     |
| ------ | ------------------------------------------------------------------------------------------- |
| Header | Detected kind (word / sentence) and the template that was used                              |
| Body   | The translation; for words, also the matched sentence (or a “no context” hint when missing) |
| Footer | `model · latency`, plus “re-translate as sentence / word”, “edit prompt”, “copy”, “close”   |

- If the detected kind is wrong, flip it with one click and re-translate — this request only, the
  setting is untouched.
- “Edit prompt” edits the **user message for this request** (variables already rendered), so it is a
  one-off experiment. To change behavior permanently, edit the system prompt in Settings.
- Inside the reader, the shortcut is bound when the selection popup renders for the first time:
  select something once after opening a new document, then the shortcut works.
- The shortcut also works in the main window, where no attachment context is available, so it does
  a plain dictionary-style lookup.

## Configuration

Settings live under `Edit` → `Settings` → `Sense Lingo`. The full 25-key reference, provider
isolation and `about:config` recipes are in
**[the configuration reference](docs/configuration.md)** (Chinese).

| Setting             | Default    | Purpose                                                                  |
| ------------------- | ---------- | ------------------------------------------------------------------------ |
| Provider preset     | `openai`   | `openai` / `deepseek` / `clinepass` / `commandcode` / `custom`           |
| API Key             | empty      | Required; stored in plain text in Zotero prefs                           |
| Base URL / Model    | empty      | Blank = preset; a bare host gets `/v1` appended automatically            |
| Temperature         | `0.3`      | Lower is more stable; 0–0.5 is recommended for translation               |
| Max tokens          | `1024`     | Upper bound for one response                                             |
| Kind detection mode | `auto`     | `auto` / `alwaysWord` / `alwaysSentence`                                 |
| Max words / chars   | `3` / `40` | Above these, a selection is treated as a sentence                        |
| Word mode context   | on         | Off = dictionary-style lookup without the containing sentence            |
| Sentence neighbours | off        | Adds one sentence before and after (more tokens)                         |
| Max sentence chars  | `400`      | Context is truncated beyond this, and the panel says so                  |
| Popup button        | on         | Inject the “Translate” button into the selection popup                   |
| Auto-translate      | off        | Translate on selection and hide the button                               |
| Shortcut            | on         | `Ctrl/⌘ + Shift + T`                                                     |
| Popup font size     | `12`       | 8–32 px                                                                  |
| Request timeout     | `30000`    | Milliseconds; timeouts surface a retry hint                              |
| Streaming           | on         | On by default; text appears as it is generated, timeout counts idle time |
| Debug logging       | off        | Writes details to `Help → Debug Output Logging`                          |

> `targetLang` defaults to `zh-CN` and is not exposed in the settings pane yet. Change it via
> `about:config`: `extensions.zotero.sense-lingo.targetLang`.

## Custom prompts

The **Prompt templates** section has one group per selection kind, and each group can keep several
prompts:

| Control       | What it does                                                            |
| ------------- | ----------------------------------------------------------------------- |
| Dropdown      | Picks the preset **currently used** for that kind (saved immediately)   |
| New / Copy    | Starts from the built-in prompt, or duplicates the current preset       |
| Delete        | Removes a custom preset; built-ins are protected and can only be edited |
| Name          | Shown in the result panel and in the preset dropdown                    |
| Multiline box | The **system** prompt sent to the model; **line breaks are preserved**  |

- The built-in preset of each kind is the fallback: it cannot be deleted, only rewritten, and a
  blank box restores its built-in text.
- The two kinds are fully independent: changing the word prompts never changes sentence behavior.
- The selected text and context are appended to the user message automatically, so you do not have
  to write `{text}` / `{sentence}` in the template.
- The result panel's preset dropdown re-translates with another preset of the same kind **for this
  run only**; it never changes the default.

Common variables:

| Variable          | Meaning           | `word` mode             | `sentence` mode                            |
| ----------------- | ----------------- | ----------------------- | ------------------------------------------ |
| `{text}`          | The selected text | the word / phrase       | the whole sentence / passage               |
| `{sentence}`      | Context sentence  | the containing sentence | empty string (avoids duplicating `{text}`) |
| `{prevSentence}`  | Previous sentence | empty                   | filled only when neighbours are enabled    |
| `{nextSentence}`  | Next sentence     | empty                   | same as above                              |
| `{selectionType}` | Detected kind     | `word`                  | `sentence`                                 |
| `{targetLang}`    | Target language   | taken from prefs        | same                                       |

> Substitution is plain text only; unknown `{tokens}` are left untouched, so LaTeX and formulas in
> your template survive.

Built-in templates, the complete variable table and ready-to-paste examples live in
**[the prompt guide](docs/prompts.md)** (Chinese).

## How it works (short version)

```text
selection (word / sentence)
      │
      ▼
detect kind   word ──► include the containing sentence as context
              sentence ──► leave {sentence} empty; optional neighbours
      │
      ▼
route to the active prompt preset → render variables → POST {baseURL}/chat/completions
      │
      ▼
inline popup translation / result panel (kind, template, sentence, model · latency)
```

A few deliberate design choices:

- **Kind detection is explainable**: a single ASCII word is not treated as a sentence just because it
  ends with a period; more than 3 words, more than 40 characters, or ≥ 8 CJK characters means
  “sentence”; a line break alone is never a signal.
- **Sentence locating** does not rely on PDF coordinates. It tries three text sources — cached
  attachment text → live reader documents → Zotero's EPUB parser — then matches text. When a word
  occurs many times, a fingerprint (±40 characters captured at selection time) picks the most likely
  occurrence.
- **Prompt routing is one line**: the detected kind picks the active preset id, and a missing /
  deleted id falls back to another preset of the same kind, then to the built-in template with a
  warning.
- **One client, many providers**: OpenAI and DeepSeek both speak the OpenAI chat-completions
  protocol; the difference is only a `baseURL` + `model` preset.

Full pipeline, matching algorithm, error codes, caching and trade-offs:
**[how it works](docs/how-it-works.md)** (Chinese).

## Relationship to zotero-pdf-translate

[zotero-pdf-translate](https://github.com/windingwind/zotero-pdf-translate) is a mature, extremely
capable plugin (20+ services, PDF / EPUB / web / metadata / annotations / notes).
**This project is not a replacement and does not compete on breadth.** It is deliberately narrow:

| Dimension     | zotero-pdf-translate              | Sense Lingo                                                       |
| ------------- | --------------------------------- | ----------------------------------------------------------------- |
| Focus         | Full translation toolbox          | One job, done deeply: selection + context                         |
| Input         | word / paragraph / whole document | selection **+ its sentence**, with **different prompts per kind** |
| Providers     | 20+, including classic engines    | LLM only, primarily OpenAI / DeepSeek compatible                  |
| Prompts       | Configurable                      | **First-class**: a preset library per kind, fully variable-driven |
| Codebase size | Large                             | Intentionally small and readable                                  |

What is reused is **engineering practice, not code**: the project is built on
[zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template)
(TypeScript + `zotero-plugin-scaffold`), uses Zotero's public
`renderTextSelectionPopup` reader event, and borrows the declarative provider-definition style from
zotero-pdf-translate.

> ⚠️ Copying code from zotero-pdf-translate means complying with its AGPL-3.0 license. This project
> is AGPL-3.0 as well.

## Privacy and security

**Please read this** — the plugin sends paper content to a third-party service.

- **What is sent**: the selected text + context (the containing sentence in word mode; two extra
  sentences in sentence mode only when neighbours are enabled, all capped by `maxSentenceChars`) +
  the prompt. **Never** the whole PDF, attachments, library metadata or file paths.
- **Where it goes**: determined by `provider` / `baseURL`. With `custom`, verify the endpoint
  yourself. No request ever goes through a proxy server run by this project.
- **API key storage**: stored in local Zotero prefs (`extensions.zotero.sense-lingo.apiKey`) in
  **plain text**. Any process that can read your Zotero profile can read it; do not use this on a
  shared machine.
- **Logs**: source text and translations are not logged by default. With `debug` on, details go to
  Zotero's debug output — do not screenshot bug reports with debug enabled.
- **Compliance**: follow your provider's terms and your institution's rules on sending paper content
  off-device. For confidential material, use a local OpenAI-compatible endpoint
  (`Custom` + a localhost URL).

## Known limitations

1. **Scanned / image-only PDFs have no context**: no text layer means no containing sentence, so the
   plugin falls back to a dictionary-style lookup. Run OCR to restore it.
2. **Sentence locating depends on text-layer quality**: two-column layouts, headers/footers and
   footnotes can shift sentence boundaries.
3. **Kind detection can be wrong**: e.g. `Not really.` or `state of the art`. Flip it in the panel,
   tune the thresholds, or force a mode.
4. **IPA is generated by the model**: reliable for common words, less so for rare words, proper nouns
   and inflections. Use a dictionary for critical pronunciation.
5. **The shortcut needs one selection first** inside a new document; from the main window there is no
   fingerprint, so repeated words may resolve to the wrong occurrence.
6. **No write-back to annotations / notes yet**; the panel can copy.

All 15 limitations plus per-symptom fixes: **[troubleshooting](docs/troubleshooting.md)** (Chinese).

## Roadmap

### v0.1 — MVP ✅ shipped

- [x] Plugin skeleton, build pipeline and settings pane
- [x] Inline selection-popup translation + shortcut result panel
- [x] Word / sentence detection with configurable thresholds
- [x] Two prompt slots, built-in templates and variable rendering
- [x] Sentence locating (neighbours, fingerprint disambiguation) + unit tests
- [x] OpenAI / DeepSeek client with unified error handling

### v0.2 — nicer to use

- [x] Streaming output (on by default, can be turned off)
- [ ] One-click write translation into annotations / notes
- [x] Prompt library (new / copy / delete, per-kind selection, in-panel switching)
- [ ] Prompt import / export
- [ ] Request cache (same word in the same sentence asks once)

### v0.3 — more capable

- [ ] Glossary / fixed terminology
- [ ] Paragraph and whole-document translation
- [ ] Local model support (Ollama / LM Studio)
- [ ] Vocabulary export (CSV / Markdown)

### Longer term

- [ ] More UI languages (ja / de / fr)
- [ ] Publish to the Zotero plugin directory

## Development

```bash
git clone https://github.com/linqingxiao/sense-lingo-zotero.git
cd sense-lingo-zotero
npm install
```

| Command              | What it does                                                    |
| -------------------- | --------------------------------------------------------------- |
| `npm start`          | Start a dev instance (configure Zotero path via `.env.example`) |
| `npm run build`      | Build + type-check, producing `sense-lingo.xpi`                 |
| `npm test`           | Vitest unit tests (13 files / 168 cases)                        |
| `npm run typecheck`  | `tsc --noEmit`                                                  |
| `npm run lint:check` | Prettier + ESLint                                               |

- Requires Node.js ≥ 22.12 (Vitest 5 requirement; 24 LTS recommended) and Zotero 7.
- `typescript` is pinned to 6.x because `ts-api-utils` does not support TS 7 yet; verify lint before
  upgrading.

Environment setup, debugging, test layers, project structure and release flow:
**[development guide](docs/development.md)** (Chinese).

## Contributing

- Bugs and feature requests: open an [issue](https://github.com/linqingxiao/sense-lingo-zotero/issues)
  with your Zotero version, plugin version, provider/model (**never an API key**) and relevant logs.
- Before opening a PR, make sure `npm run build`, `npm test` and `npm run lint:check` all pass.
- New pure logic should live under `src/modules/reader/` or `src/modules/llm/` and come with tests.

## Acknowledgements and license

- Architecture and engineering practice come from
  [zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template),
  [zotero-plugin-scaffold](https://github.com/northword/zotero-plugin-scaffold) and
  [zotero-types](https://github.com/windingwind/zotero-types);
- Feature and interaction inspiration come from
  [zotero-pdf-translate](https://github.com/windingwind/zotero-pdf-translate);
- Thanks to the Zotero community.

Released under **AGPL-3.0** (see [`LICENSE`](LICENSE)), matching the reference projects.
Check your local regulations and your provider's terms before use.
