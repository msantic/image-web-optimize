import { app, BrowserWindow, ipcMain, shell } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import { optimizeImages } from './optimizer/image'
import { optimizeVideo, type VideoPreset } from './optimizer/video'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.JPG', '.JPEG', '.PNG'])
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.MOV'])

let mainWindow: BrowserWindow

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 700,
    height: 560,
    minWidth: 520,
    minHeight: 420,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#1c1c1e',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

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
