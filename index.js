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
const inputDir = inputArg
  ? path.resolve(__dirname, inputArg)
  : path.join(__dirname, 'input');
const outputDir = path.join(__dirname, 'output');

// Check if input directory exists
if (!(await fs.pathExists(inputDir))) {
  console.error(`❌ Input folder does not exist: ${inputDir}`);
  process.exit(1);
}

await fs.ensureDir(outputDir);
const files = await globby([
  `${inputDir}/**/*.{jpg,jpeg,png,JPG,JPEG,PNG}`
]);

const maxWidthArg = process.argv[3];
const maxWidth = maxWidthArg ? parseInt(maxWidthArg, 10) : 1600;

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

console.log(`\n🎉 Done! All images have been resized to a max width of ${maxWidth}px and converted to WebP in ./output/`);
