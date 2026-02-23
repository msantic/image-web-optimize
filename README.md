# Image & Video Optimizer

Electron desktop app + CLI for batch image (WebP) and video (MP4/H.264) optimization.

## Desktop App

```bash
npm install
npm run dev
```

Drag and drop images or videos onto the window. Outputs land in an `optimized/` subfolder next to your source files.

### macOS setup notes

`npm install` handles everything automatically, including:
- Rebuilding `sharp` for the installed Electron version (`electron-rebuild`)
- Re-signing the Electron bundle (`codesign --force --deep --sign -`)

**If the app crashes on launch or `process.type` is undefined**, the cause is almost always
`ELECTRON_RUN_AS_NODE=1` leaking into the environment (VSCode sets this for its own Electron
internals). The `npm run dev` script already strips it with `env -u ELECTRON_RUN_AS_NODE`, so
running via npm is always safe. Never run the Electron binary directly inside a VSCode terminal
without unsetting that variable first.

## CLI

```bash
node index.mjs <INPUT-FOLDER> [<MAX-WIDTH>]
```

- `<INPUT-FOLDER>`: path to folder with jpg/jpeg/png images
- `<MAX-WIDTH>`: max output width in pixels (default: 1600)

**Example:**
```bash
node index.mjs ~/photos/ 1200
```

Output saved to `<INPUT-FOLDER>/optimized/` as `.webp` files. Existing files are skipped.

## Video conversion (direct ffmpeg)

```bash
node_modules/ffmpeg-static/ffmpeg \
  -i input.mov \
  -c:v libx264 -crf 23 -preset fast \
  -c:a aac -b:a 128k -movflags +faststart \
  -vf "scale='min(1280,iw)':'min(720,ih)':force_original_aspect_ratio=decrease" \
  output.mp4 -y
```

## Stack

- **Electron 40** + electron-vite 5 + TypeScript
- **sharp** — WebP conversion (native, no imagemin)
- **fluent-ffmpeg** + **ffmpeg-static** — bundled video encoder, no system ffmpeg needed
- Vanilla TypeScript renderer, dark macOS UI (SF Pro, traffic-light titlebar)
