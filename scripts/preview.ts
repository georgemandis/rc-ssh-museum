#!/usr/bin/env bun
/**
 * Generate a half-block terminal preview PNG for an artwork submission.
 *
 * Usage:
 *   bun scripts/preview.ts gallery/my-artwork
 *   bun scripts/preview.ts gallery/my-artwork --output preview.png --cols 80
 *
 * Reads meta.json + art.png/art.gif from the given directory and produces
 * a PNG that mimics the half-block terminal rendering.
 */

import sharp from "sharp";
import { readFile } from "fs/promises";
import { join } from "path";
import { parseArgs } from "util";

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    output: { type: "string", short: "o", default: "preview.png" },
    cols: { type: "string", default: "80" },
    "cell-size": { type: "string", default: "10" },
    "bg-color": { type: "string", default: "#1a1b26" },
  },
  allowPositionals: true,
});

const artworkDir = positionals[0];
if (!artworkDir) {
  console.error("Usage: bun scripts/preview.ts <artwork-dir> [--output preview.png] [--cols 80]");
  process.exit(1);
}

const outputPath = values.output!;
const cols = parseInt(values.cols!, 10);
const cellSize = parseInt(values["cell-size"]!, 10);
const bgColor = values["bg-color"]!;

// Parse background color
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

const [bgR, bgG, bgB] = hexToRgb(bgColor);

// Load meta.json
let meta: { title?: string; artist?: string; statement?: string } = {};
try {
  const raw = await readFile(join(artworkDir, "meta.json"), "utf-8");
  meta = JSON.parse(raw);
} catch {
  console.error("Warning: could not read meta.json");
}

// Find the artwork image
let imagePath = "";
for (const name of ["art.gif", "art.png", "art.jpg", "art.jpeg"]) {
  try {
    await readFile(join(artworkDir, name));
    imagePath = join(artworkDir, name);
    break;
  } catch {}
}

if (!imagePath) {
  console.error("No artwork image found (art.png, art.gif, art.jpg)");
  process.exit(1);
}

// For GIFs, extract first frame
const imageBuffer = await readFile(imagePath);
const image = sharp(imageBuffer, { animated: false, pages: 1 });
const metadata = await image.metadata();

// Calculate dimensions for half-block rendering
// Each column = 1 pixel wide, each row = 2 pixels tall (half-block pairs)
// Resize image to fit `cols` columns, maintaining aspect ratio
const aspectRatio = (metadata.height ?? 1) / (metadata.width ?? 1);
const imgCols = cols;
// Half-blocks give us 2 vertical pixels per row, so rows = ceil(height / 2)
const imgPixelH = Math.round(imgCols * aspectRatio);
const imgRows = Math.ceil(imgPixelH / 2);
const imgPixelHEven = imgRows * 2; // Ensure even height for half-block pairs

const resized = await image
  .resize(imgCols, imgPixelHEven, { fit: "fill" })
  .removeAlpha()
  .raw()
  .toBuffer();

// Build the half-block color grid
// Each cell has a top color and bottom color
type CellColor = { topR: number; topG: number; topB: number; botR: number; botG: number; botB: number };
const grid: CellColor[][] = [];

for (let row = 0; row < imgRows; row++) {
  const gridRow: CellColor[] = [];
  for (let col = 0; col < imgCols; col++) {
    const topIdx = (row * 2 * imgCols + col) * 3;
    const botIdx = ((row * 2 + 1) * imgCols + col) * 3;
    gridRow.push({
      topR: resized[topIdx], topG: resized[topIdx + 1], topB: resized[topIdx + 2],
      botR: resized[botIdx], botG: resized[botIdx + 1], botB: resized[botIdx + 2],
    });
  }
  grid.push(gridRow);
}

// Now render to PNG
// Each terminal cell = cellSize wide × cellSize tall
// Top half of cell = top color, bottom half = bottom color
const textLines: string[] = [];
if (meta.title) textLines.push(meta.title);
if (meta.artist) textLines.push(`by ${meta.artist}`);
if (meta.statement) {
  textLines.push("");
  // Word-wrap statement to cols
  const words = meta.statement.split(/\s+/);
  let line = "";
  for (const word of words) {
    if (line.length + word.length + 1 > cols) {
      textLines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) textLines.push(line);
}

const fontSize = Math.max(10, Math.floor(cellSize * 0.9));
const textRowHeight = Math.max(cellSize, fontSize + 4); // Ensure enough room per line
const textPadding = textLines.length > 0 ? cellSize : 0; // Gap between image and text
const totalTextHeight = textLines.length * textRowHeight + textPadding + Math.floor(textRowHeight / 2);

const cellW = cellSize;
const cellH = cellSize * 2; // Terminal cells are ~2:1 tall
const outW = cols * cellW;
const outH = imgRows * cellH + totalTextHeight;
const pixels = Buffer.alloc(outW * outH * 3);

// Fill with background color
for (let i = 0; i < pixels.length; i += 3) {
  pixels[i] = bgR;
  pixels[i + 1] = bgG;
  pixels[i + 2] = bgB;
}

// Draw the half-block image
for (let row = 0; row < imgRows; row++) {
  for (let col = 0; col < imgCols; col++) {
    const cell = grid[row][col];
    const halfH = Math.floor(cellH / 2);

    // Top half
    for (let dy = 0; dy < halfH; dy++) {
      for (let dx = 0; dx < cellW; dx++) {
        const idx = ((row * cellH + dy) * outW + (col * cellW + dx)) * 3;
        pixels[idx] = cell.topR;
        pixels[idx + 1] = cell.topG;
        pixels[idx + 2] = cell.topB;
      }
    }
    // Bottom half
    for (let dy = halfH; dy < cellH; dy++) {
      for (let dx = 0; dx < cellW; dx++) {
        const idx = ((row * cellH + dy) * outW + (col * cellW + dx)) * 3;
        pixels[idx] = cell.botR;
        pixels[idx + 1] = cell.botG;
        pixels[idx + 2] = cell.botB;
      }
    }
  }
}

// Draw text using a simple bitmap approach
// We'll use sharp's composite with SVG text overlay for clean rendering
const imgBase = await sharp(pixels, { raw: { width: outW, height: outH, channels: 3 } })
  .png()
  .toBuffer();

if (textLines.length > 0) {
  const textY = imgRows * cellH + textPadding;
  const svgLines = textLines.map((line, i) => {
    const y = textY + i * textRowHeight + fontSize;
    const escaped = line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const color = i === 0 ? "#e8e8e8" : "#888888";
    const weight = i === 0 ? "bold" : "normal";
    return `<text x="${cellSize}" y="${y}" fill="${color}" font-weight="${weight}" font-size="${fontSize}" font-family="monospace">${escaped}</text>`;
  }).join("\n");

  const svgOverlay = Buffer.from(
    `<svg width="${outW}" height="${outH}" xmlns="http://www.w3.org/2000/svg">${svgLines}</svg>`
  );

  await sharp(imgBase)
    .composite([{ input: svgOverlay, top: 0, left: 0 }])
    .toFile(outputPath);
} else {
  await sharp(imgBase).toFile(outputPath);
}

console.log(`Preview saved to ${outputPath} (${outW}×${outH})`);
