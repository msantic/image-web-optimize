import fs from 'fs-extra';
import path from 'path';
import { globby } from 'globby';
import imagemin from 'imagemin';
import imageminWebp from 'imagemin-webp';
import slugify from 'slugify';
import sharp from 'sharp';
import { fileURLToPath } from 'url';

// ⛔ Required for __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const inputArg = process.argv[2];
const inputPath = inputArg
  ? path.resolve(inputArg.startsWith('/') || inputArg.startsWith('~') 
      ? inputArg.replace(/^~/, process.env.HOME) 
      : path.resolve(__dirname, inputArg))
  : path.join(__dirname, 'input');

// Check if input path exists
if (!(await fs.pathExists(inputPath))) {
  console.error(`❌ Input path does not exist: ${inputPath}`);
  process.exit(1);
}

const maxWidthArg = process.argv[3];
const maxWidth = maxWidthArg ? parseInt(maxWidthArg, 10) : 1600;

// Check if input is a file or directory
const inputStat = await fs.stat(inputPath);
const isSingleFile = inputStat.isFile();

let files;
let outputDir;

if (isSingleFile) {
  // Single file mode - output to same directory as input file
  files = [inputPath];
  outputDir = path.dirname(inputPath);
} else {
  // Directory mode - output to 'output' folder inside input directory
  outputDir = path.join(inputPath, 'output');
  await fs.ensureDir(outputDir);
  files = await globby([
    `${inputPath}/**/*.{jpg,jpeg,png,JPG,JPEG,PNG}`
  ]);
}

for (const file of files) { 
  const parsed = path.parse(file);
  const base = parsed.name; // This strips ALL extensions
  const friendlyName = slugify(base, { lower: true, strict: true });
  const outWebp = path.join(outputDir, `${friendlyName}.webp`);

  if (await fs.pathExists(outWebp)) {
    console.log(`⏭️  Skipping ${file}: ${outWebp} already exists`);
    continue;
  }

  try {
    // Resize to max width using sharp
    const resizedBuffer = await sharp(file)
      .resize({ width: maxWidth, withoutEnlargement: true })
      .rotate() // auto-orient based on EXIF
      .toBuffer();

    // Convert to WebP using imagemin
    const buffer = await imagemin.buffer(resizedBuffer, {
      plugins: [imageminWebp({ quality: 80 })]
    });

    await fs.writeFile(outWebp, buffer);
    console.log(`✅ ${file} → ${outWebp}`);
  } catch (err) {
    console.warn(`⚠️  Skipping ${file}: ${err.message}`);
  }
}

if (isSingleFile) {
  console.log(`\n🎉 Done! Image resized to max width ${maxWidth}px and converted to WebP`);
} else {
  console.log(`\n🎉 Done! All images have been resized to a max width of ${maxWidth}px and converted to WebP in ${outputDir}`);
}
