// Renderer — vanilla TypeScript, no framework needed for a tool this simple.
// Communicates with the main process via window.optimizer (exposed by preload).

interface OptimizerAPI {
  optimizeFiles: (files: string[], options: { maxWidth: number; videoPreset: string }) => Promise<{ success: boolean }>
  openInFinder: (dirPath: string) => Promise<void>
  getPathForFile: (file: File) => string
  onFileProgress: (cb: (data: ProgressData) => void) => void
  removeProgressListener: () => void
}

interface ProgressData {
  file: string
  status: 'processing' | 'done' | 'skipped' | 'error'
  percent?: number
  outPath?: string
  error?: string
}

declare const window: Window & { optimizer: OptimizerAPI }

const VIDEO_EXTS = new Set(['mp4', 'mov', 'avi', 'mkv', 'webm'])

const dropZone = document.getElementById('drop-zone')!
const queue    = document.getElementById('queue')!
const fileList = document.getElementById('file-list')!
const summary  = document.getElementById('queue-summary')!
const clearBtn = document.getElementById('clear-btn')!

interface QueueItem { el: HTMLLIElement; status: string }
const items = new Map<string, QueueItem>()

// ─── Drag & Drop ─────────────────────────────────────────────────────────────

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault()
  dropZone.classList.add('drag-over')
})

dropZone.addEventListener('dragleave', (e) => {
  if (!dropZone.contains(e.relatedTarget as Node)) {
    dropZone.classList.remove('drag-over')
  }
})

dropZone.addEventListener('drop', async (e) => {
  e.preventDefault()
  dropZone.classList.remove('drag-over')

  // Use webUtils.getPathForFile (Electron 32+) to get real filesystem paths
  const files: string[] = []
  for (const item of e.dataTransfer!.items) {
    if (item.kind === 'file') {
      const file = item.getAsFile()
      if (file) {
        const filePath = window.optimizer.getPathForFile(file)
        if (filePath) files.push(filePath)
      }
    }
  }

  if (files.length === 0) return

  const options = {
    maxWidth: parseInt((document.getElementById('max-width') as HTMLSelectElement).value, 10),
    videoPreset: (document.getElementById('video-preset') as HTMLSelectElement).value,
  }

  files.forEach(addToQueue)
  try {
    await window.optimizer.optimizeFiles(files, options)
  } catch (err) {
    console.error('optimizeFiles failed:', err)
  }
})

// ─── Progress ─────────────────────────────────────────────────────────────────

function registerProgressListener(): void {
  window.optimizer.onFileProgress((data) => {
    if (!items.has(data.file)) addToQueue(data.file)

    const item = items.get(data.file)!
    item.status = data.status
    item.el.dataset['status'] = data.status

    const statusEl = item.el.querySelector('.item-status')!

    if (data.status === 'processing') {
      statusEl.textContent = data.percent && data.percent > 0 ? `${data.percent}%` : 'Processing…'
    } else if (data.status === 'done') {
      statusEl.textContent = 'Done ✓'
      if (data.outPath) {
        const outDir = data.outPath.substring(0, data.outPath.lastIndexOf('/'))
        const pathEl = item.el.querySelector('.item-path') as HTMLElement
        pathEl.textContent = 'Show in Finder →'
        pathEl.style.cursor = 'pointer'
        pathEl.onclick = () => window.optimizer.openInFinder(outDir)
      }
    } else if (data.status === 'skipped') {
      statusEl.textContent = 'Already exists'
    } else if (data.status === 'error') {
      statusEl.textContent = `Error: ${data.error}`
    }

    updateSummary()
  })
}

registerProgressListener()

// ─── Queue helpers ─────────────────────────────────────────────────────────────

function addToQueue(filePath: string): void {
  if (items.has(filePath)) return

  queue.hidden = false

  const fileName = filePath.split('/').pop()!
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  const isVideo = VIDEO_EXTS.has(ext)

  const li = document.createElement('li')
  li.className = 'queue-item'
  li.dataset['status'] = 'queued'
  li.innerHTML = `
    <span class="item-type ${isVideo ? 'video' : 'image'}">${isVideo ? 'video' : 'image'}</span>
    <div class="item-info">
      <span class="item-name">${fileName}</span>
      <span class="item-path">${filePath}</span>
    </div>
    <span class="item-status">Queued</span>
  `

  fileList.appendChild(li)
  items.set(filePath, { el: li, status: 'queued' })
  updateSummary()
}

function updateSummary(): void {
  const total = items.size
  const done  = [...items.values()].filter((i) => i.status === 'done' || i.status === 'skipped').length
  summary.textContent = `${done} of ${total} complete`
}

clearBtn.addEventListener('click', () => {
  items.clear()
  fileList.innerHTML = ''
  queue.hidden = true
  summary.textContent = ''
  window.optimizer.removeProgressListener()
  registerProgressListener()
})
