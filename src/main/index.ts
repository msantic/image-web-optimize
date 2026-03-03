import { app, BrowserWindow, ipcMain, shell, desktopCapturer, dialog, systemPreferences } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import { execFile } from 'child_process'
import { createRequire } from 'module'
import fs from 'fs-extra'
import { optimizeImages } from './optimizer/image'
import { optimizeVideo, type VideoPreset } from './optimizer/video'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// fluent-ffmpeg for WebM → MP4 conversion of recordings
const require = createRequire(import.meta.url)
const ffmpegModule = require('fluent-ffmpeg')

// ffmpeg-static is in asarUnpack so the binary is extracted to app.asar.unpacked,
// but require() still returns the app.asar path — correct it so the OS can execute it.
const _rawFfmpegPath = require('ffmpeg-static') as string
const ffmpegPath = _rawFfmpegPath.includes('app.asar')
  ? _rawFfmpegPath.replace('app.asar', 'app.asar.unpacked')
  : _rawFfmpegPath
ffmpegModule.setFfmpegPath(ffmpegPath)

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.JPG', '.JPEG', '.PNG'])
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.MOV'])

let mainWindow: BrowserWindow

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 700,
    height: 620,
    minWidth: 520,
    minHeight: 480,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#1c1c1e',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // Use the macOS 15 SCContentSharingPicker for getDisplayMedia() calls.
  mainWindow.webContents.session.setDisplayMediaRequestHandler((_request, callback) => {
    callback({})
  }, { useSystemPicker: true })

  // electron-vite sets ELECTRON_RENDERER_URL in dev mode (Vite dev server)
  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ─── IPC Handlers ────────────────────────────────────────────────────────────

interface OptimizeOptions {
  maxWidth: number
  videoPreset: VideoPreset
}

ipcMain.handle(
  'optimize-files',
  async (_event, { files, options }: { files: string[]; options: OptimizeOptions }) => {
    for (const filePath of files) {
      const ext = path.extname(filePath)

      if (IMAGE_EXTS.has(ext)) {
        await optimizeImages(filePath, {
          maxWidth: options.maxWidth ?? 1600,
          onProgress: (data) => mainWindow.webContents.send('file-progress', data),
        })
      } else if (VIDEO_EXTS.has(ext)) {
        await optimizeVideo(filePath, {
          preset: options.videoPreset ?? '720p',
          onProgress: (data) => mainWindow.webContents.send('file-progress', data),
        })
      }
    }
    return { success: true }
  },
)

ipcMain.handle('open-in-finder', (_event, dirPath: string) => {
  shell.openPath(dirPath)
})

ipcMain.handle('open-external', (_event, url: string) => {
  shell.openExternal(url)
})

// ─── Recorder IPC Handlers ───────────────────────────────────────────────────

// List visible app names via AppleScript (for the window resize picker)
ipcMain.handle('get-running-apps', async () => {
  return new Promise<string[]>((resolve) => {
    execFile(
      'osascript',
      ['-e', 'tell application "System Events" to get name of every process whose background only is false'],
      (err, stdout) => {
        if (err) { resolve([]); return }
        const apps = stdout.split(',').map((s) => s.trim()).filter(Boolean)
        resolve(apps.sort())
      },
    )
  })
})

ipcMain.handle(
  'resize-window',
  async (
    _e,
    { app: appName, width, height, x = 0, y = 0 }: { app: string; width: number; height: number; x?: number; y?: number },
  ) => {
    const script = `
      tell application "${appName}" to activate
      tell application "System Events"
        tell process "${appName}"
          set size of window 1 to {${width}, ${height}}
          set position of window 1 to {${x}, ${y}}
        end tell
      end tell`
    return new Promise<void>((resolve, reject) =>
      execFile('osascript', ['-e', script], (err) => (err ? reject(err) : resolve())),
    )
  },
)

ipcMain.handle(
  'save-recording',
  async (_e, { buffer, outputDir, mimeType, normalizeAudio, hasAudio, rawOutput }: {
    buffer: ArrayBuffer; outputDir: string; mimeType: string
    normalizeAudio: boolean; hasAudio: boolean; rawOutput: boolean
  }) => {
    const expandedDir = outputDir.startsWith('~')
      ? outputDir.replace('~', app.getPath('home'))
      : outputDir
    await fs.ensureDir(expandedDir)

    // Convert whatever IPC delivers into a Node.js Buffer robustly.
    // Electron may deliver the ArrayBuffer as a Buffer, Uint8Array, or raw ArrayBuffer
    // depending on serialization path — handle all three.
    let data: Buffer
    if (Buffer.isBuffer(buffer)) {
      data = buffer
    } else if (buffer instanceof Uint8Array) {
      data = Buffer.from(buffer)
    } else {
      data = Buffer.from(new Uint8Array(buffer as ArrayBuffer))
    }

    if (data.length === 0) {
      throw new Error('Recording produced empty data. Try recording for a longer time.')
    }

    const timestamp = Date.now()
    const isInputMp4 = mimeType.includes('mp4')
    const nativeExt = isInputMp4 ? '.mp4' : '.webm'

    const tempPath = path.join(expandedDir, `recording-${timestamp}-tmp${nativeExt}`)

    await fs.writeFile(tempPath, data)

    // Raw output: high-quality MP4 (CRF 12, preset slow) — visually near-lossless,
    // opens natively everywhere, works in all editors, reasonable file size.
    if (rawOutput) {
      const rawPath = path.join(expandedDir, `recording-${timestamp}-raw.mp4`)
      const rawOptions = ['-c:v libx264', '-crf 12', '-preset slow', '-movflags +faststart']
      if (hasAudio) {
        rawOptions.push('-c:a aac', '-b:a 320k')
      } else {
        rawOptions.push('-an')
      }
      try {
        await new Promise<void>((resolve, reject) => {
          ffmpegModule(tempPath)
            .outputOptions(rawOptions)
            .output(rawPath)
            .on('end', resolve)
            .on('error', (_err: Error, _stdout: string, stderr: string) =>
              reject(new Error(stderr || _err.message)),
            )
            .run()
        })
      } finally {
        await fs.remove(tempPath).catch(() => {})
      }
      return rawPath
    }

    const mp4Path  = path.join(expandedDir, `recording-${timestamp}.mp4`)

    // Run ffmpeg: remux MP4 (copy) or convert WebM→MP4 (re-encode).
    // Audio: normalize with EBU R128 loudnorm if requested and audio exists.
    const outputOptions: string[] = isInputMp4
      ? ['-c:v copy']
      : ['-c:v libx264', '-crf 18', '-preset medium']  // crf 18 = high quality

    if (hasAudio) {
      outputOptions.push('-c:a aac', '-b:a 192k')
      if (normalizeAudio) {
        outputOptions.push('-af loudnorm=I=-16:TP=-1.5:LRA=11')
      }
    } else {
      outputOptions.push('-an')
    }

    outputOptions.push('-movflags +faststart')

    try {
      await new Promise<void>((resolve, reject) => {
        ffmpegModule(tempPath)
          .outputOptions(outputOptions)
          .output(mp4Path)
          .on('end', resolve)
          .on('error', (_err: Error, _stdout: string, stderr: string) =>
            reject(new Error(stderr || _err.message)),
          )
          .run()
      })
    } finally {
      // Always remove temp file, whether ffmpeg succeeded or failed
      await fs.remove(tempPath).catch(() => {})
    }

    return mp4Path
  },
)

ipcMain.handle('choose-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
  })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('get-permissions', () => ({
  screen: systemPreferences.getMediaAccessStatus('screen'),
  microphone: systemPreferences.getMediaAccessStatus('microphone'),
}))

ipcMain.handle('set-dock-badge', (_e, text: string) => {
  app.dock.setBadge(text)
})
