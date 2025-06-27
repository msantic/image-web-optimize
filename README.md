# Image web optimize

## Usage

```bash
node index.js <INPUT-FOLDER> [<MAX-WIDTH>]
```

- `<INPUT-FOLDER>`: Path to your folder with images (jpg/jpeg/png, any case).
- `<MAX-WIDTH>`: (Optional) Maximum width in pixels for resizing. Default is 1600.

**Example:**
```bash
node index.js ~/input-folder/ 1200
```

## Output

- All converted `.webp` images will be saved in the `output/` folder.
- Existing `.webp` files in `output/` will be skipped.

## Requirements

- Node.js 18+
- Install dependencies with:
  ```bash
  npm install
  ```

## Features

- Recursively finds all jpg/jpeg/png images (case-insensitive).
- Resizes images to the specified max width (no enlargement).
- Auto-orients images based on EXIF data.
- Converts all images to WebP format.
- Skips images that are already converted.
