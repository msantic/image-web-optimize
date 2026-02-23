import path from 'path'
import fs from 'fs-extra'
import sharp from 'sharp'
import slugify from 'slugify'

export interface ImageProgressEvent {
  file: string
  status: 'processing' | 'done' | 'skipped' | 'error'
  outPath?: string
  error?: string
}

export interface ImageOptions {
  maxWidth?: number
  onProgress?: (event: ImageProgressEvent) => void
}

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png'])

async function findImages(dir: string): Promise<string[]> {
  const results: string[] = []
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...(await findImages(full)))
    } else if (IMAGE_EXTS.has(path.extname(entry.name).toLowerCase())) {
      results.push(full)
    }
  }
  return results
}

export async function optimizeImages(
  inputPath: string,
  options: ImageOptions = {},
): Promise<void> {
  const { maxWidth = 1600, onProgress = () => {} } = options

  const stat = await fs.stat(inputPath)
  const isSingleFile = stat.isFile()

  const files = isSingleFile ? [inputPath] : await findImages(inputPath)
  const outputDir = isSingleFile
    ? path.join(path.dirname(inputPath), 'optimized')
    : path.join(inputPath, 'optimized')

  await fs.ensureDir(outputDir)

  for (const file of files) {
    const friendlyName = slugify(path.parse(file).name, { lower: true, strict: true })
    const outWebp = path.join(outputDir, `${friendlyName}.webp`)

    if (await fs.pathExists(outWebp)) {
      onProgress({ file, status: 'skipped', outPath: outWebp })
      continue
    }

    onProgress({ file, status: 'processing' })

    try {
      await sharp(file)
        .resize({ width: maxWidth, withoutEnlargement: true })
        .rotate()
        .webp({ quality: 80 })
        .toFile(outWebp)

      onProgress({ file, status: 'done', outPath: outWebp })
    } catch (err) {
      onProgress({ file, status: 'error', error: (err as Error).message })
    }
  }
}
