import { Box, Text } from "ink";
import type { GalleryConfig } from "../lib/gallery.js";
import { useTerminalSize } from "../lib/useTerminalSize.js";

type Props = {
  screen: string;
  config: GalleryConfig | null;
  prevTitle?: string | null;
  nextTitle?: string | null;
  hasArchive?: boolean;
};

const hints: Record<string, string[]> = {
  list: ["↑/↓ navigate", "enter view", "q quit"],
  detail: ["b/esc back"],
};

export function Footer({ screen, config, prevTitle, nextTitle, hasArchive }: Props) {
  const { cols } = useTerminalSize();
  const items = [...(hints[screen] ?? [])];
  if (screen === "list" && hasArchive) items.push("a archive");
  if (screen === "list" && config?.subscribeEnabled !== false) items.push("s subscribe");
  if (screen === "list" && config?.submitMethod === "github-pr") items.push("u submit");
  const name = config?.name ?? "mussheum";

  return (
    <Box width={cols} justifyContent="space-between">
      <Text color="gray"> {name}{config?.exhibition ? <Text dimColor italic> · {config.exhibition}</Text> : null}</Text>
      <Box gap={2}>
        {screen === "detail" && prevTitle && (
          <Text dimColor>← {prevTitle}</Text>
        )}
        {items.map((hint) => (
          <Text key={hint} dimColor>
            {hint}
          </Text>
        ))}
        {screen === "detail" && nextTitle && (
          <Text dimColor>{nextTitle} →</Text>
        )}
      </Box>
      <Text color="gray"> </Text>
    </Box>
  );
}
