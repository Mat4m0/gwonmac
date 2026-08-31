/** Build the tracked multi-size Windows icon from the canonical application PNG. */
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { PNG } from "pngjs";

export const WINDOWS_ICON_SIZES = [16, 24, 32, 48, 64, 128, 256] as const;

function resizedPng(source: PNG, size: number): Buffer {
  const result = new PNG({ width: size, height: size });
  const scaleX = source.width / size;
  const scaleY = source.height / size;
  for (let y = 0; y < size; y += 1) {
    const sourceY = Math.max(0, Math.min(source.height - 1, (y + 0.5) * scaleY - 0.5));
    const y0 = Math.floor(sourceY);
    const y1 = Math.min(source.height - 1, y0 + 1);
    const fy = sourceY - y0;
    for (let x = 0; x < size; x += 1) {
      const sourceX = Math.max(0, Math.min(source.width - 1, (x + 0.5) * scaleX - 0.5));
      const x0 = Math.floor(sourceX);
      const x1 = Math.min(source.width - 1, x0 + 1);
      const fx = sourceX - x0;
      const target = (y * size + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        const top = source.data[(y0 * source.width + x0) * 4 + channel]! * (1 - fx)
          + source.data[(y0 * source.width + x1) * 4 + channel]! * fx;
        const bottom = source.data[(y1 * source.width + x0) * 4 + channel]! * (1 - fx)
          + source.data[(y1 * source.width + x1) * 4 + channel]! * fx;
        result.data[target + channel] = Math.round(top * (1 - fy) + bottom * fy);
      }
    }
  }
  return PNG.sync.write(result, { colorType: 6, inputColorType: 6 });
}

export function windowsIcon(sourceBytes: Buffer): Buffer {
  const source = PNG.sync.read(sourceBytes);
  if (source.width !== source.height || source.width < 256) {
    throw new Error("Windows icon source must be a square PNG at least 256 pixels wide");
  }
  const images = WINDOWS_ICON_SIZES.map((size) => resizedPng(source, size));
  const directorySize = 6 + images.length * 16;
  const output = Buffer.alloc(directorySize + images.reduce((sum, image) => sum + image.length, 0));
  output.writeUInt16LE(0, 0);
  output.writeUInt16LE(1, 2);
  output.writeUInt16LE(images.length, 4);
  let imageOffset = directorySize;
  images.forEach((image, index) => {
    const size = WINDOWS_ICON_SIZES[index]!;
    const entry = 6 + index * 16;
    output.writeUInt8(size === 256 ? 0 : size, entry);
    output.writeUInt8(size === 256 ? 0 : size, entry + 1);
    output.writeUInt8(0, entry + 2);
    output.writeUInt8(0, entry + 3);
    output.writeUInt16LE(1, entry + 4);
    output.writeUInt16LE(32, entry + 6);
    output.writeUInt32LE(image.length, entry + 8);
    output.writeUInt32LE(imageOffset, entry + 12);
    image.copy(output, imageOffset);
    imageOffset += image.length;
  });
  return output;
}

async function main(): Promise<void> {
  const [source, destination, ...extra] = process.argv.slice(2);
  if (!source || !destination || extra.length > 0) {
    throw new Error("usage: windows-icon <source.png> <destination.ico>");
  }
  await writeFile(destination, windowsIcon(await readFile(source)));
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
