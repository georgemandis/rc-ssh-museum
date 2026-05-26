import { Box, Text, useInput } from "ink";
import { useState } from "react";
import type { Artwork, CuratorNote, GalleryConfig } from "../lib/gallery.js";
import { useTerminalSize } from "../lib/useTerminalSize.js";

type Props = {
  artworks: Artwork[];
  onSelect: (index: number) => void;
  visitorCount: number | null;
  curatorNote: CuratorNote | null;
  config: GalleryConfig | null;
};

export function GalleryList({ artworks, onSelect, visitorCount, curatorNote, config }: Props) {
  const [selected, setSelected] = useState(0);
  const { rows, cols } = useTerminalSize();
  // Reserve space for header line, spacing, and footer
  const visibleRows = rows - 6;

  useInput((_input, key) => {
    if (key.upArrow) {
      setSelected((s) => Math.max(0, s - 1));
    } else if (key.downArrow) {
      setSelected((s) => Math.min(artworks.length - 1, s + 1));
    } else if (key.return) {
      onSelect(selected);
    }
  });

  // Scroll window: keep selected item visible
  const scrollStart = Math.max(0, Math.min(selected - Math.floor(visibleRows / 2), artworks.length - visibleRows));
  const visible = artworks.slice(Math.max(0, scrollStart), Math.max(0, scrollStart) + visibleRows);
  const startIndex = Math.max(0, scrollStart);

  const galleryName = config?.name ?? "";
  const accent = config?.accentColor ?? "magenta";
  const secondary = config?.secondaryColor ?? "cyan";

  const maxWidth = Math.min(cols, 100);
  const leftWidth = Math.floor(maxWidth * 0.4);
  const rightWidth = maxWidth - leftWidth;

  return (
    <Box width={cols} justifyContent="center">
    <Box width={maxWidth}>
      {/* Left: artwork list */}
      <Box flexDirection="column" width={leftWidth}>
        <Text bold color={accent}>{galleryName}</Text>
        {config?.exhibition && (
          <Text color={secondary} italic>{config.exhibition}</Text>
        )}
        <Text dimColor>{artworks.length} work{artworks.length !== 1 ? "s" : ""}</Text>
        {visitorCount !== null && visitorCount > 0 && (
          <Text dimColor>{visitorCount} visitor{visitorCount !== 1 ? "s" : ""} in the gallery</Text>
        )}
        <Text> </Text>
        {visible.map((artwork, i) => {
          const globalIndex = startIndex + i;
          const isSelected = globalIndex === selected;
          return (
            <Box key={artwork.slug} flexDirection="column">
              <Text
                backgroundColor={isSelected ? accent : undefined}
                color={isSelected ? "black" : undefined}
              >
                {isSelected ? " > " : "   "}
                {artwork.title}
              </Text>
              <Text dimColor>{"    "}{artwork.artist}</Text>
            </Box>
          );
        })}
      </Box>

      {/* Right: curator note */}
      {curatorNote && (
        <Box flexDirection="column" width={rightWidth} paddingLeft={4}>
          <Text dimColor italic>Curatorial Note — {curatorNote.date}</Text>
          <Text> </Text>
          {curatorNote.note.split("\n\n").map((para, i) => (
            <Box key={i} marginBottom={1}>
              <Text dimColor wrap="wrap">{para}</Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
    </Box>
  );
}
