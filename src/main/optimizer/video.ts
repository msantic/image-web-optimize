import path from 'path'
import fs from 'fs-extra'
import slugify from 'slugify'
import { createRequire } from 'module'

// fluent-ffmpeg and ffmpeg-static are CJS packages — use createRequire from ESM
const require = createRequire(import.meta.url)
const ffmpegModule = require('fluent-ffmpeg')
const ffmpegPath = require('ffmpeg-static') as string

// Point fluent-ffmpeg at the bundled binary (no system ffmpeg required) — synchronous
ffmpegModule.setFfmpegPath(ffmpegPath)

const ffmpeg = ffmpegModule as (input: string) => FfmpegCommand

interface FfmpegCommand {
  outputOptions(options: string[]): FfmpegCommand
  videoFilter(filter: string): FfmpegCommand
  output(path: string): FfmpegCommand
  on(event: 'progress', cb: (p: { percent?: number }) => void): FfmpegCommand
  on(event: 'end', cb: () => void): FfmpegCommand
  on(event: 'error', cb: (err: Error) => void): FfmpegCommand
  run(): void
}

const PRESETS = {
  same:  { width: null,  height: null, crf: 23 },
  '1080p': { width: 1920, height: 1080, crf: 23 },
  '720p':  { width: 1280, height: 720,  crf: 23 },
  '480p':  { width: 854,  height: 480,  crf: 26 },
} as const

export type VideoPreset = keyof typeof PRESETS

export interface VideoProgressEvent {
  file: string
  status: 'processing' | 'done' | 'error'
  percent?: number
  outPath?: string
  error?: string
}

export interface VideoOptions {
  preset?: VideoPreset
  onProgress?: (event: VideoProgressEvent) => void
}

export async function optimizeVideo(
  inputFile: string,
  options: VideoOptions = {},
): Promise<string> {
  const { preset = '720p', onProgress = () => {} } = options
  const config = PRESETS[preset] ?? PRESETS['720p']

  const parsed = path.parse(inputFile)
  const outputDir = path.join(parsed.dir, 'optimized')
  await fs.ensureDir(outputDir)

  const friendlyName = slugify(parsed.name, { lower: true, strict: true })
  const outFile = path.join(outputDir, `${friendlyName}.mp4`)

  onProgress({ file: inputFile, status: 'processing', percent: 0 })

  return new Promise((resolve, reject) => {
    let command = ffmpeg(inputFile).outputOptions([
      '-c:v libx264',
      `-crf ${config.crf}`,
      '-preset fast',
      '-c:a aac',
      '-b:a 128k',
      '-movflags +faststart',
    ])

    if (config.width && config.height) {
      command = command.videoFilter(
        `scale='min(${config.width},iw)':'min(${config.height},ih)':force_original_aspect_ratio=decrease`,
      )
    }

    command
      .output(outFile)
      .on('progress', (p) => {
        onProgress({ file: inputFile, status: 'processing', percent: Math.round(p.percent ?? 0) })
      })
      .on('end', () => {
        onProgress({ file: inputFile, status: 'done', outPath: outFile })
        resolve(outFile)
      })
      .on('error', (err) => {
        onProgress({ file: inputFile, status: 'error', error: err.message })
        reject(err)
      })
      .run()
  })
}
