import { contextBridge, ipcRenderer, webUtils } from 'electron'

export interface ProgressEvent {
  file: string
  status: 'processing' | 'done' | 'skipped' | 'error'
  percent?: number
  outPath?: string
  error?: string
}

export interface OptimizeOptions {
  maxWidth: number
  videoPreset: string
}

contextBridge.exposeInMainWorld('optimizer', {
  // ─── Optimize ──────────────────────────────────────────────────────────────
  optimizeFiles: (files: string[], options: OptimizeOptions) =>
    ipcRenderer.invoke('optimize-files', { files, options }),

  openInFinder: (dirPath: string) =>
    ipcRenderer.invoke('open-in-finder', dirPath),

  getPathForFile: (file: File) =>
    webUtils.getPathForFile(file),

  onFileProgress: (callback: (data: ProgressEvent) => void) => {
    ipcRenderer.on('file-progress', (_event, data: ProgressEvent) => callback(data))
  },

  removeProgressListener: () => {
    ipcRenderer.removeAllListeners('file-progress')
  },

  // ─── Recorder ──────────────────────────────────────────────────────────────
  getRunningApps: () => ipcRenderer.invoke('get-running-apps'),

  resizeWindow: (p: { app: string; width: number; height: number; x?: number; y?: number }) =>
    ipcRenderer.invoke('resize-window', p),

  saveRecording: (p: { buffer: ArrayBuffer; outputDir: string; mimeType: string; normalizeAudio: boolean; hasAudio: boolean; rawOutput: boolean }) =>
    ipcRenderer.invoke('save-recording', p),

  chooseDirectory: () => ipcRenderer.invoke('choose-directory'),

  getPermissions: () => ipcRenderer.invoke('get-permissions'),

  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),

  setDockBadge: (text: string) => ipcRenderer.invoke('set-dock-badge', text),
})
