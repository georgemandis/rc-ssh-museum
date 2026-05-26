import chalk from "chalk";
import { Box, measureElement, Text } from "ink";
import { useEffect, useRef, useState } from "react";
import { useTerminalCapabilities } from "ink-picture";
import sharp from "sharp";

const HALF_BLOCK = "\u2584";
const MAX_FRAMES = 200;
const DEFAULT_FPS = 5;

type Props = {
  src: string;
  width?: number;
  height?: number;
  alt?: string;
  fps?: number;
  onSupportDetected?: (supported: boolean) => void;
};

function toHalfBlocks(data: Buffer, width: number, height: number, channels: number): string {
  let result = "";
  for (let y = 0; y < height - 1; y += 2) {
    for (let x = 0; x < width; x++) {
      const topIdx = (y * width + x) * channels;
      const bottomIdx = ((y + 1) * width + x) * channels;
      const r = data[topIdx]!;
      const g = data[topIdx + 1]!;
      const b = data[topIdx + 2]!;
      const a = channels === 4 ? data[topIdx + 3]! : 255;
      const r2 = data[bottomIdx]!;
      const g2 = data[bottomIdx + 1]!;
      const b2 = data[bottomIdx + 2]!;
      result += a === 0
        ? chalk.reset(" ")
        : chalk.bgRgb(r, g, b).rgb(r2, g2, b2)(HALF_BLOCK);
    }
    result += "\n";
  }
  return result;
}

export function AnimatedHalfBlockImage({ src, width: propsWidth, height: propsHeight, alt, fps = DEFAULT_FPS, onSupportDetected }: Props) {
  const [frames, setFrames] = useState<string[]>([]);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [hasError, setHasError] = useState(false);
  const containerRef = useRef<any>(null);
  const terminalCapabilities = useTerminalCapabilities();

  // Detect terminal support
  useEffect(() => {
    if (!terminalCapabilities) return;
    const isSupported = terminalCapabilities.supportsColor && terminalCapabilities.supportsUnicode;
    onSupportDetected?.(isSupported);
  }, [onSupportDetected, terminalCapabilities]);

  // Extract and pre-render all frames
  useEffect(() => {
    let cancelled = false;

    const extractFrames = async () => {
      try {
        const metadata = await sharp(src, { pages: -1 }).metadata();
        const pageCount = Math.min(metadata.pages ?? 1, MAX_FRAMES);

        if (!containerRef.current) return;
        const { width: maxWidth, height: maxHeight } = measureElement(containerRef.current);

        const aspectRatio = (metadata.width ?? 1) / ((metadata.pageHeight ?? metadata.height ?? 1));

        // Calculate target size (height * 2 because half-blocks represent 2 pixels per row)
        let targetHeight = propsHeight ? propsHeight * 2 : maxHeight * 2;
        let targetWidth = propsWidth ?? Math.round(targetHeight * aspectRatio);
        if (targetWidth > maxWidth) {
          targetWidth = maxWidth;
          targetHeight = Math.round(targetWidth / aspectRatio);
        }
        if (targetHeight > maxHeight * 2) {
          targetHeight = maxHeight * 2;
          targetWidth = Math.round(targetHeight * aspectRatio);
        }
        targetWidth = Math.max(1, Math.round(targetWidth));
        targetHeight = Math.max(2, Math.round(targetHeight));

        const rendered: string[] = [];
        for (let i = 0; i < pageCount; i++) {
          if (cancelled) return;
          const { data, info } = await sharp(src, { page: i })
            .resize(targetWidth, targetHeight)
            .raw()
            .toBuffer({ resolveWithObject: true });
          rendered.push(toHalfBlocks(data, info.width, info.height, info.channels));
        }

        if (!cancelled) {
          setFrames(rendered);
          setHasError(false);
        }
      } catch {
        if (!cancelled) {
          setHasError(true);
        }
      }
    };

    extractFrames();
    return () => { cancelled = true; };
  }, [src, propsWidth, propsHeight]);

  // Animation interval
  useEffect(() => {
    if (frames.length <= 1) return;
    const interval = setInterval(() => {
      setCurrentFrame((prev) => (prev + 1) % frames.length);
    }, 1000 / fps);
    return () => clearInterval(interval);
  }, [frames.length, fps]);

  const frameOutput = frames[currentFrame];

  return (
    <Box ref={containerRef} flexDirection="column" flexGrow={1}>
      {frameOutput ? (
        frameOutput.split("\n").filter(Boolean).map((line, i) => (
          <Text key={i}>{line}</Text>
        ))
      ) : (
        <Box flexDirection="column" alignItems="center" justifyContent="center">
          {hasError && <Text color="red">Load failed</Text>}
          <Text color="gray">{alt || "Loading..."}</Text>
        </Box>
      )}
    </Box>
  );
}
