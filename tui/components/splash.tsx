import { Box, Text } from "ink";
import { HalfBlockImage } from "ink-picture";
import BigText from "ink-big-text";
import { useState, useEffect, type ReactNode } from "react";
import { readFile } from "fs/promises";
import { join, dirname } from "path";
import type { GalleryConfig } from "../lib/gallery.js";
import { useTerminalSize } from "../lib/useTerminalSize.js";

type Props = {
  error?: string | null;
  children?: ReactNode;
  config: GalleryConfig | null;
};

export function Splash({ error, children, config }: Props) {
  const { rows, cols } = useTerminalSize();
  const [showCursor, setShowCursor] = useState(true);
  const [asciiArt, setAsciiArt] = useState<string | null>(null);
  const accent = config?.accentColor ?? "cyan";
  const name = config?.name ?? "mussheum";
  const tagline = config?.tagline ?? "an ssh art gallery";
  const splash = config?.splash ?? "bigtext";

  const baseDir = join(dirname(process.argv[1] ?? "."), "..");
  const galleryDir = join(baseDir, "gallery");

  useEffect(() => {
    const blink = setInterval(() => {
      setShowCursor((v) => !v);
    }, 530);
    return () => clearInterval(blink);
  }, []);

  // Load ASCII art file if needed
  useEffect(() => {
    if (splash !== "ascii") return;
    readFile(join(galleryDir, "splash.txt"), "utf-8")
      .then((content) => setAsciiArt(content.trimEnd()))
      .catch(() => setAsciiArt(null));
  }, [splash]);

  const cursor = showCursor ? "\u2588" : " ";

  // Mode: "image" — full-screen image, no text
  if (splash === "image") {
    const imagePath = join(galleryDir, "splash.png");
    return (
      <Box
        flexDirection="column"
        height={rows}
        width={cols}
        alignItems="center"
        justifyContent="center"
      >
        <HalfBlockImage src={imagePath} width={cols} height={rows - 2} onSupportDetected={() => {}} />
        <Text>
          <Text color={accent}>{cursor}</Text>
        </Text>
        {error && <Text color="red">{error}</Text>}
        {children}
      </Box>
    );
  }

  // Mode: "ascii" — ASCII art replaces bigtext
  if (splash === "ascii") {
    return (
      <Box
        flexDirection="column"
        height={rows}
        width={cols}
        alignItems="center"
        justifyContent="center"
      >
        {asciiArt ? (
          asciiArt.split("\n").map((line, i) => (
            <Text key={i} color={accent}>{line}</Text>
          ))
        ) : (
          <BigText text={name} font="tiny" colors={[accent]} />
        )}
        <Text dimColor>{tagline}</Text>
        {config?.exhibition && (
          <Text dimColor italic>{config.exhibition}</Text>
        )}
        <Text> </Text>
        <Text>
          <Text color={accent}>{cursor}</Text>
        </Text>
        {error && (
          <>
            <Text> </Text>
            <Text color="red">{error}</Text>
          </>
        )}
        {children}
      </Box>
    );
  }

  // Mode: "logo" — small image above bigtext
  if (splash === "logo") {
    const logoPath = join(galleryDir, "logo.png");
    const logoHeight = Math.min(Math.floor(rows * 0.3), 10);
    const logoWidth = Math.min(Math.floor(cols * 0.5), 60);
    return (
      <Box
        flexDirection="column"
        height={rows}
        width={cols}
        alignItems="center"
        justifyContent="center"
      >
        <Box height={logoHeight} width={logoWidth} justifyContent="center">
          <HalfBlockImage src={logoPath} width={logoWidth} height={logoHeight} onSupportDetected={() => {}} />
        </Box>
        <Text> </Text>
        <BigText text={name} font="tiny" colors={[accent]} />
        <Text dimColor>{tagline}</Text>
        {config?.exhibition && (
          <Text dimColor italic>{config.exhibition}</Text>
        )}
        <Text> </Text>
        <Text>
          <Text color={accent}>{cursor}</Text>
        </Text>
        {error && (
          <>
            <Text> </Text>
            <Text color="red">{error}</Text>
          </>
        )}
        {children}
      </Box>
    );
  }

  // Mode: "bigtext" (default) — current behavior
  return (
    <Box
      flexDirection="column"
      height={rows}
      width={cols}
      alignItems="center"
      justifyContent="center"
    >
      <BigText text={name} font="tiny" colors={[accent]} />
      <Text dimColor>{tagline}</Text>
      {config?.exhibition && (
        <Text dimColor italic>{config.exhibition}</Text>
      )}
      <Text> </Text>
      <Text>
        <Text color={accent}>{cursor}</Text>
      </Text>
      {error && (
        <>
          <Text> </Text>
          <Text color="red">{error}</Text>
        </>
      )}
      {children}
    </Box>
  );
}
