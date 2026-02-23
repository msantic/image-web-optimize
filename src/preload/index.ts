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
})
