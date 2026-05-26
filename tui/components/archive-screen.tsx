import { Box, Text, useInput } from "ink";
import { useState } from "react";
import type { ArchivedExhibition, GalleryConfig } from "../lib/gallery.js";
import { useTerminalSize } from "../lib/useTerminalSize.js";

type Props = {
  archive: ArchivedExhibition[];
  config: GalleryConfig | null;
  onBack: () => void;
};

export function ArchiveScreen({ archive, config, onBack }: Props) {
  const { rows, cols } = useTerminalSize();
  const accent = config?.accentColor ?? "cyan";
  const [scrollOffset, setScrollOffset] = useState(0);

  const visibleRows = rows - 4;

  useInput((input, key) => {
    if (input === "b" || input === "q" || key.escape) {
      onBack();
    } else if (key.upArrow) {
      setScrollOffset((s) => Math.max(0, s - 1));
    } else if (key.downArrow) {
      setScrollOffset((s) => s + 1);
    }
  });

  // Build all lines
  const lines: { text: string; dim?: boolean; italic?: boolean; bold?: boolean; color?: string }[] = [];

  for (const exhibition of archive) {
    lines.push({ text: exhibition.exhibition, bold: true, color: accent });
    for (const piece of exhibition.pieces) {
      lines.push({ text: `  ${piece.title}`, dim: false });
      lines.push({ text: `  ${piece.artist}`, dim: true, italic: true });
    }
    lines.push({ text: "" });
  }

  const maxScroll = Math.max(0, lines.length - visibleRows);
  const clampedOffset = Math.min(scrollOffset, maxScroll);
  const visible = lines.slice(clampedOffset, clampedOffset + visibleRows);

  const maxWidth = Math.min(cols, 60);

  return (
    <Box flexDirection="column" height={rows} width={cols}>
      <Box width={cols} justifyContent="center">
        <Box flexDirection="column" width={maxWidth} paddingTop={1}>
          <Text dimColor italic>Past Exhibitions</Text>
          <Text> </Text>
          {visible.map((line, i) => (
            <Text
              key={clampedOffset + i}
              bold={line.bold}
              dimColor={line.dim}
              italic={line.italic}
              color={line.color}
            >
              {line.text}
            </Text>
          ))}
        </Box>
      </Box>
    </Box>
  );
}
