import { Box, Text } from "ink";
import { useState, useEffect } from "react";
import { formatNextOpening, type GalleryConfig, type GalleryStatus } from "../lib/gallery.js";
import { useTerminalSize } from "../lib/useTerminalSize.js";

type Props = {
  config: GalleryConfig | null;
  status: GalleryStatus & { open: false };
  onOpen: () => void;
};

export function ClosedScreen({ config, status, onOpen }: Props) {
  const { rows, cols } = useTerminalSize();
  const accent = config?.accentColor ?? "cyan";
  const name = config?.name ?? "mussheum";
  const [now, setNow] = useState(() => new Date());

  const nextDate = status.nextOpeningDate;

  // Get timezone from the first hours rule for display
  const tz = config?.hours && config.hours !== "closed" && config.hours.length > 0
    ? config.hours[0].tz
    : undefined;

  useEffect(() => {
    if (!nextDate) return;
    const interval = setInterval(() => {
      const current = new Date();
      setNow(current);
      if (current.getTime() >= nextDate.getTime()) {
        clearInterval(interval);
        onOpen();
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [nextDate]);

  const makeLink = (url: string) => {
    const visible = url.replace(/^https?:\/\//, "");
    return `\x1b]8;;${url}\x07${visible}\x1b]8;;\x07`;
  };

  const newsletterUrl = config?.newsletterUrl;
  const newsletterCta = config?.newsletterCta ?? "Sign up for updates on our next exhibition";
  const submissionsUrl = config?.submissionsUrl;
  const submissionsCta = config?.submissionsCta ?? "Interested in showing your work?";

  const countdownText = nextDate ? formatNextOpening(nextDate, tz) : null;

  const contentWidth = Math.min(cols - 4, 60);

  return (
    <Box
      flexDirection="column"
      height={rows}
      width={cols}
      alignItems="center"
      justifyContent="center"
    >
      <Box flexDirection="column" width={contentWidth} alignItems="center">
        <Text bold color={accent}>{name}</Text>
        {config?.exhibition && (
          <Text dimColor italic>{config.exhibition}</Text>
        )}
        <Text> </Text>
        <Text>The gallery is currently closed.</Text>
        {countdownText && (
          <Text dimColor>Opens {countdownText}</Text>
        )}
        {newsletterUrl && (
          <Box flexDirection="column" width={contentWidth} alignItems="center" marginTop={1}>
            <Text dimColor wrap="wrap">{newsletterCta}</Text>
            <Text color={accent}>{makeLink(newsletterUrl)}</Text>
          </Box>
        )}
        {submissionsUrl && (
          <Box flexDirection="column" width={contentWidth} alignItems="center" marginTop={1}>
            <Text dimColor>{submissionsCta}</Text>
            <Text color={accent}>{makeLink(submissionsUrl)}</Text>
          </Box>
        )}
        <Text> </Text>
        <Text dimColor>{config?.subscribeEnabled !== false ? "s subscribe  " : ""}q quit</Text>
      </Box>
    </Box>
  );
}
