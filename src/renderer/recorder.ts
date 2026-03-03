// Record tab — window picker, resize, audio selection, screen capture, save to MP4

interface RecorderBridge {
  getRunningApps: () => Promise<string[]>
  resizeWindow: (p: { app: string; width: number; height: number; x?: number; y?: number }) => Promise<void>
  saveRecording: (p: { buffer: ArrayBuffer; outputDir: string; mimeType: string; normalizeAudio: boolean; hasAudio: boolean }) => Promise<string>
  chooseDirectory: () => Promise<string | null>
  getPermissions: () => Promise<{ screen: string; microphone: string }>
  openInFinder: (dirPath: string) => Promise<void>
  openExternal: (url: string) => Promise<void>
  setDockBadge: (text: string) => Promise<void>
}

declare const window: Window & { optimizer: RecorderBridge }

const SIZE_PRESETS: Record<string, { width: number; height: number; x: number; y: number }> = {
  '1944x1100': { width: 1944, height: 1100, x: 100, y: 80 },
  '1920x1080': { width: 1920, height: 1080, x: 0, y: 0 },
  '1280x720': { width: 1280, height: 720, x: 0, y: 0 },
  '2560x1440': { width: 2560, height: 1440, x: 0, y: 0 },
}

let mediaRecorder: MediaRecorder | null = null
let recordedChunks: Blob[] = []
let timerInterval: ReturnType<typeof setInterval> | null = null
let timerSeconds = 0
let systemAudioDeviceId: string | null = null
let saveDir = '~/Movies/Recordings'
let recordedMimeType = 'video/webm'

// All active recording resources tracked here so every exit path can clean them up.
let activeVideoStream: MediaStream | null = null
let activeAudioCtx: AudioContext | null = null
let activeMicStream: MediaStream | null = null
let activeSysStream: MediaStream | null = null
let isRecording = false

function cleanupRecordingResources(): void {
  activeVideoStream?.getTracks().forEach((t) => t.stop())
  activeMicStream?.getTracks().forEach((t) => t.stop())
  activeSysStream?.getTracks().forEach((t) => t.stop())
  activeAudioCtx?.close().catch(() => {})
  activeVideoStream = null
  activeMicStream = null
  activeSysStream = null
  activeAudioCtx = null
  mediaRecorder = null
  recordedChunks = []
}

// ─── Show / hide helpers ──────────────────────────────────────────────────────

function show(id: string): void {
  document.getElementById(id)?.removeAttribute('hidden')
}

function hide(id: string): void {
  document.getElementById(id)?.setAttribute('hidden', '')
}

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T
}

// ─── Init ─────────────────────────────────────────────────────────────────────

export async function initRecorder(): Promise<void> {
  const stored = localStorage.getItem('recorder-save-dir')
  if (stored) saveDir = stored
  el('save-dir').textContent = saveDir

  await checkPermissions()
  await loadRunningApps()
  await loadAudioDevices()

  el('refresh-sources-btn').addEventListener('click', loadRunningApps)
  el('perm-settings-btn').addEventListener('click', () => {
    window.optimizer.openExternal(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
    )
  })
  el('size-preset').addEventListener('change', onPresetChange)
  el('resize-btn').addEventListener('click', onResizeClick)
  el('choose-dir-btn').addEventListener('click', onChooseDir)
  el('record-btn').addEventListener('click', startRecording)
  el('stop-btn').addEventListener('click', stopRecording)
  el('show-result-btn').addEventListener('click', onShowResult)

  onPresetChange()
}

// ─── Permissions ──────────────────────────────────────────────────────────────

async function checkPermissions(): Promise<void> {
  const perms = await window.optimizer.getPermissions()
  const issues: string[] = []
  if (perms.screen !== 'granted') issues.push('Screen Recording')
  if (perms.microphone !== 'granted') issues.push('Microphone')

  if (issues.length > 0) {
    el('perm-warning-text').textContent =
      `Grant ${issues.join(' & ')} access in System Settings → Privacy & Security → ${issues[0]}`
    // Show settings button only for screen recording (mic prompts automatically)
    el('perm-settings-btn').style.display = perms.screen !== 'granted' ? 'inline-block' : 'none'
    show('perm-warning')
  } else {
    hide('perm-warning')
  }
}

// ─── Running Apps (for resize picker) ────────────────────────────────────────

async function loadRunningApps(): Promise<void> {
  const select = el<HTMLSelectElement>('window-select')
  select.innerHTML = '<option>Loading…</option>'
  try {
    const apps = await window.optimizer.getRunningApps()
    select.innerHTML = ''
    if (apps.length === 0) {
      select.innerHTML = '<option disabled value="">No apps found</option>'
      return
    }
    for (const appName of apps) {
      const opt = document.createElement('option')
      opt.value = appName
      opt.textContent = appName
      select.appendChild(opt)
    }
  } catch (err) {
    console.error('getRunningApps failed:', err)
    select.innerHTML = '<option disabled value="">Failed to list apps</option>'
  }
}

// ─── Audio Devices ────────────────────────────────────────────────────────────

async function loadAudioDevices(): Promise<void> {
  // Request mic access so labels populate
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    stream.getTracks().forEach((t) => t.stop())
  } catch {
    // Permission denied — labels may be missing but we still enumerate
  }

  const devices = await navigator.mediaDevices.enumerateDevices()
  const inputs = devices.filter((d) => d.kind === 'audioinput')

  const micSelect = el<HTMLSelectElement>('mic-select')
  micSelect.innerHTML = '<option value="">None</option>'
  for (const device of inputs) {
    const opt = document.createElement('option')
    opt.value = device.deviceId
    opt.textContent = device.label || `Microphone ${micSelect.options.length + 1}`
    micSelect.appendChild(opt)
  }

  // Detect virtual loopback driver (BlackHole, Soundflower, Loopback)
  const loopback = inputs.find((d) => /blackhole|soundflower|loopback/i.test(d.label))
  const toggle = el<HTMLInputElement>('system-audio-toggle')
  const label = el('system-audio-label')

  if (loopback) {
    systemAudioDeviceId = loopback.deviceId
    toggle.disabled = false
    label.textContent = `Include system audio (${loopback.label})`
  } else {
    systemAudioDeviceId = null
    toggle.disabled = true
    label.innerHTML =
      'Include system audio ' +
      '<a href="https://existential.audio/blackhole/" target="_blank" class="link">(install BlackHole)</a>'
  }
}

// ─── Preset / Resize ─────────────────────────────────────────────────────────

function onPresetChange(): void {
  const presetSelect = el<HTMLSelectElement>('size-preset')
  const dimInputs = el('dim-inputs')
  const wInput = el<HTMLInputElement>('dim-w')
  const hInput = el<HTMLInputElement>('dim-h')

  const preset = SIZE_PRESETS[presetSelect.value]
  if (preset) {
    wInput.value = String(preset.width)
    hInput.value = String(preset.height)
    dimInputs.style.opacity = '0.5'
    wInput.readOnly = true
    hInput.readOnly = true
  } else {
    dimInputs.style.opacity = '1'
    wInput.readOnly = false
    hInput.readOnly = false
  }
}

async function onResizeClick(): Promise<void> {
  const windowSelect = el<HTMLSelectElement>('window-select')
  const selectedOpt = windowSelect.selectedOptions[0]
  if (!selectedOpt) return

  const appName = selectedOpt.value || selectedOpt.textContent || ''
  const wInput = el<HTMLInputElement>('dim-w')
  const hInput = el<HTMLInputElement>('dim-h')
  const presetSelect = el<HTMLSelectElement>('size-preset')
  const preset = SIZE_PRESETS[presetSelect.value]

  const width = parseInt(wInput.value, 10)
  const height = parseInt(hInput.value, 10)
  const x = preset?.x ?? 0
  const y = preset?.y ?? 0

  const btn = el<HTMLButtonElement>('resize-btn')
  btn.textContent = 'Resizing…'
  btn.disabled = true

  try {
    await window.optimizer.resizeWindow({ app: appName, width, height, x, y })
    btn.textContent = 'Done ✓'
    setTimeout(() => {
      btn.textContent = 'Resize'
      btn.disabled = false
    }, 1500)
  } catch (err) {
    btn.textContent = 'Failed'
    btn.disabled = false
    console.error('resize-window failed:', err)
  }
}

// ─── Save Directory ───────────────────────────────────────────────────────────

async function onChooseDir(): Promise<void> {
  const dir = await window.optimizer.chooseDirectory()
  if (dir) {
    saveDir = dir
    localStorage.setItem('recorder-save-dir', dir)
    el('save-dir').textContent = dir
  }
}

// ─── Recording ────────────────────────────────────────────────────────────────

let recordedHasAudio = false

function playBeep(isGo: boolean): void {
  const ctx = new AudioContext()
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.type = 'sine'
  osc.frequency.value = isGo ? 880 : 440
  const duration = isGo ? 0.35 : 0.12
  gain.gain.setValueAtTime(0.4, ctx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration)
  osc.start()
  osc.stop(ctx.currentTime + duration)
  setTimeout(() => ctx.close(), duration * 1000 + 100)
}

async function countdown(): Promise<void> {
  return new Promise((resolve) => {
    const numEl = el('countdown-number')
    let count = 3

    const tick = (): void => {
      numEl.textContent = String(count)
      numEl.style.animation = 'none'
      void numEl.offsetHeight  // force reflow
      numEl.style.animation = ''

      if (count === 0) {
        playBeep(true)
        void window.optimizer.setDockBadge('')
        setTimeout(() => { hide('countdown-overlay'); resolve() }, 950)
        return
      }

      playBeep(false)
      void window.optimizer.setDockBadge(String(count))
      count--
      setTimeout(tick, 1000)
    }

    show('countdown-overlay')
    tick()
  })
}

async function startRecording(): Promise<void> {
  if (isRecording) return  // guard against double-start
  isRecording = true

  const micDeviceId = el<HTMLSelectElement>('mic-select').value
  const systemAudioOn = el<HTMLInputElement>('system-audio-toggle').checked

  try {
    activeVideoStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 30 },
      audio: false,
    })

    activeAudioCtx = new AudioContext()
    const destination = activeAudioCtx.createMediaStreamDestination()

    if (micDeviceId) {
      activeMicStream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: micDeviceId } },
        video: false,
      })
      activeAudioCtx.createMediaStreamSource(activeMicStream).connect(destination)
    }

    if (systemAudioOn && systemAudioDeviceId) {
      try {
        activeSysStream = await navigator.mediaDevices.getUserMedia({
          audio: { deviceId: { exact: systemAudioDeviceId } },
          video: false,
        })
        activeAudioCtx.createMediaStreamSource(activeSysStream).connect(destination)
      } catch (e) {
        console.warn('System audio capture failed:', e)
      }
    }

    const audioTracks = destination.stream.getAudioTracks()
    recordedHasAudio = audioTracks.length > 0

    const combined = new MediaStream([
      ...activeVideoStream.getVideoTracks(),
      ...audioTracks,
    ])

    // VP9/VP8 WebM: bundled OpenH264 fails on Retina resolutions (>9.4MP).
    // VP9/VP8 have no pixel limit; ffmpeg converts WebM→MP4 after recording.
    recordedMimeType = (
      ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'] as const
    ).find((t) => MediaRecorder.isTypeSupported(t)) ?? 'video/webm'

    recordedChunks = []
    mediaRecorder = new MediaRecorder(combined, { mimeType: recordedMimeType })
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordedChunks.push(e.data)
    }
    mediaRecorder.onstop = () => {
      cleanupRecordingResources()
      stopTimer()
      void finalizeRecording()
    }

    // Countdown fires AFTER streams are acquired — user can switch to target app
    await countdown()

    mediaRecorder.start(1000)
    startTimer()

    hide('record-idle')
    show('record-active')
    hide('record-result')
  } catch (err) {
    cleanupRecordingResources()
    isRecording = false
    stopTimer()
    hide('record-active')
    show('record-idle')
    // Ignore user-initiated cancellation (picker dismissed, mic denied interactively)
    const name = (err as Error).name
    if (name !== 'NotAllowedError' && name !== 'AbortError') {
      console.error('startRecording failed:', err)
      alert(`Recording failed: ${(err as Error).message}`)
    }
  }
}

function stopRecording(): void {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') {
    // Already stopped or never started — ensure UI is consistent
    cleanupRecordingResources()
    isRecording = false
    stopTimer()
    hide('record-active')
    show('record-idle')
    return
  }
  mediaRecorder.stop()  // triggers onstop → cleanupRecordingResources + finalizeRecording
  hide('record-active')
}

async function finalizeRecording(): Promise<void> {
  const chunks = recordedChunks.slice()  // snapshot before cleanup clears the array
  const mimeType = recordedMimeType
  const hasAudio = recordedHasAudio
  isRecording = false

  if (chunks.length === 0) {
    alert('No recording data was captured. Try recording for a longer time.')
    show('record-idle')
    return
  }

  const stopBtn = el<HTMLButtonElement>('stop-btn')
  stopBtn.textContent = 'Saving…'
  stopBtn.disabled = true

  try {
    const blob = new Blob(chunks, { type: mimeType })
    const buffer = await blob.arrayBuffer()
    const normalizeAudio = el<HTMLInputElement>('normalize-audio-toggle').checked

    const mp4Path = await window.optimizer.saveRecording({
      buffer,
      outputDir: saveDir,
      mimeType,
      normalizeAudio,
      hasAudio,
    })

    el('result-path').textContent = mp4Path.split('/').pop() ?? mp4Path
    el<HTMLButtonElement>('show-result-btn').dataset['path'] = mp4Path
    show('record-result')
    show('record-idle')
  } catch (err) {
    console.error('saveRecording failed:', err)
    alert(`Save failed: ${(err as Error).message}`)
    show('record-idle')
  } finally {
    stopBtn.textContent = 'Stop'
    stopBtn.disabled = false
  }
}

function onShowResult(): void {
  const btn = el<HTMLButtonElement>('show-result-btn')
  const filePath = btn.dataset['path']
  if (!filePath) return
  const dir = filePath.substring(0, filePath.lastIndexOf('/'))
  window.optimizer.openInFinder(dir)
}

// ─── Timer ────────────────────────────────────────────────────────────────────

function startTimer(): void {
  timerSeconds = 0
  updateTimer()
  timerInterval = setInterval(() => {
    timerSeconds++
    updateTimer()
  }, 1000)
}

function stopTimer(): void {
  if (timerInterval !== null) {
    clearInterval(timerInterval)
    timerInterval = null
  }
}

function updateTimer(): void {
  const m = String(Math.floor(timerSeconds / 60)).padStart(2, '0')
  const s = String(timerSeconds % 60).padStart(2, '0')
  el('record-timer').textContent = `${m}:${s}`
}
