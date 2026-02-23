// CLI entry point — uses sharp natively for WebP conversion (no imagemin needed)
import fs from 'fs-extra';
import path from 'path';
import sharp from 'sharp';
import slugify from 'slugify';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png']);

async function findImages(dir) {
  const results = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...await findImages(full));
    else if (IMAGE_EXTS.has(path.extname(entry.name).toLowerCase())) results.push(full);
  }
  return results;
}

const inputArg = process.argv[2];
const inputPath = inputArg
  ? path.resolve(inputArg.startsWith('/') || inputArg.startsWith('~')
      ? inputArg.replace(/^~/, process.env.HOME)
      : path.resolve(__dirname, inputArg))
  : path.join(__dirname, 'input');

if (!(await fs.pathExists(inputPath))) {
  console.error(`❌ Input path does not exist: ${inputPath}`);
  process.exit(1);
}

const maxWidth = process.argv[3] ? parseInt(process.argv[3], 10) : 1600;
const inputStat = await fs.stat(inputPath);
const isSingleFile = inputStat.isFile();

const files = isSingleFile ? [inputPath] : await findImages(inputPath);
const outputDir = isSingleFile ? path.join(path.dirname(inputPath), 'optimized') : path.join(inputPath, 'optimized');
await fs.ensureDir(outputDir);

for (const file of files) {
  const friendlyName = slugify(path.parse(file).name, { lower: true, strict: true });
  const outWebp = path.join(outputDir, `${friendlyName}.webp`);

  if (await fs.pathExists(outWebp)) {
    console.log(`⏭️  Skipping ${file}: already exists`);
    continue;
  }

  try {
    await sharp(file)
      .resize({ width: maxWidth, withoutEnlargement: true })
      .rotate()
      .webp({ quality: 80 })
      .toFile(outWebp);
    console.log(`✅ ${file} → ${outWebp}`);
  } catch (err) {
    console.warn(`⚠️  Skipping ${file}: ${err.message}`);
  }
}

console.log(`\n🎉 Done! Output in ${outputDir}`);
