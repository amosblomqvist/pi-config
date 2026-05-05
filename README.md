# pi-config

A small library of my personal [pi](https://github.com/badlogic/pi-mono) skills and extensions.

This is **not** meant to be installed as one big package. Browse the repo and copy the pieces you want into your own Pi config.

## Copy an extension

Single-file extension:

```bash
cp extensions/ask-user-question.ts ~/.pi/agent/extensions/
```

Directory extension:

```bash
cp -r extensions/web-fetch ~/.pi/agent/extensions/
```

If the copied extension has a `package.json`, install its deps:

```bash
cd ~/.pi/agent/extensions/web-fetch
npm install
```

Then restart pi or run `/reload`.

## Copy a skill

```bash
cp -r skills/reddit ~/.pi/agent/skills/
```

Then restart pi or run `/reload`.

## Do not clone over your config

Avoid cloning this repo directly into `~/.pi/agent` unless it is a fresh setup. If you already use pi, copy individual files/folders instead so you do not replace your own config.

## Dependencies

Extension-local npm deps are kept with the extension. Run `npm install` only in copied extensions that include `package.json`.

Extensions with npm deps:

- `bash-guard/`
- `filechanges/`
- `web-fetch/`

Optional system tools:

```bash
brew install yt-dlp ffmpeg
```

Used by `youtube-search/` and `video-extract/`.

PDF reader setup after copying `skills/pdf-reader/`:

```bash
python3 -m venv ~/.pi/agent/skills/pdf-reader/.venv
~/.pi/agent/skills/pdf-reader/.venv/bin/pip install -r ~/.pi/agent/skills/pdf-reader/requirements.txt
```

Google search tools use either env vars:

```bash
export GOOGLE_SEARCH_API_KEY="..."
export GOOGLE_CSE_ID="..."
```

or a local `auth.json` copied from `auth.example.json`.

## Contents

### Extensions

- `ask-user-question.ts`
- `bash-guard/`
- `context.ts`
- `custom-header.ts`
- `filechanges/`
- `google-image-search/`
- `md-link.ts`
- `memory.ts`
- `subagents/`
- `video-extract/`
- `web-fetch/`
- `web-search/`
- `youtube-search/`
- `zz-read-only-mode.ts`

### Skills

- `orchestrator/`
- `pdf-reader/`
- `reddit/`
- `stop-slop/`
