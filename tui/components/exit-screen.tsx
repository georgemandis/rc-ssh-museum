import { Box, Text } from "ink";
import type { GalleryConfig } from "../lib/gallery.js";
import { useTerminalSize } from "../lib/useTerminalSize.js";

type Props = {
  config: GalleryConfig | null;
};

export function ExitScreen({ config }: Props) {
  const { rows, cols } = useTerminalSize();
  const accent = config?.accentColor ?? "cyan";
  const name = config?.name ?? "mussheum";

  const newsletterUrl = config?.newsletterUrl;
  const newsletterCta = config?.newsletterCta ?? "Sign up for updates on our next exhibition";
  const submissionsUrl = config?.submissionsUrl;
  const submissionsCta = config?.submissionsCta ?? "Interested in showing your work?";

  // Show the URL visibly, but make it a clickable OSC 8 link
  const makeLink = (url: string) => {
    const visible = url.replace(/^https?:\/\//, "");
    return `\x1b]8;;${url}\x07${visible}\x1b]8;;\x07`;
  };

  return (
    <Box
      flexDirection="column"
      height={rows}
      width={cols}
      alignItems="center"
      justifyContent="center"
    >
      <Text dimColor>Thank you for visiting {name}.</Text>
      {config?.exhibition && (
        <Text dimColor italic>{config.exhibition}</Text>
      )}
      {newsletterUrl && (
        <>
          <Text> </Text>
          <Text dimColor>{newsletterCta}:</Text>
          <Text color={accent}>{makeLink(newsletterUrl)}</Text>
        </>
      )}
      {submissionsUrl && (
        <>
          <Text> </Text>
          <Text dimColor>{submissionsCta}</Text>
          <Text color={accent}>{makeLink(submissionsUrl)}</Text>
        </>
      )}
    </Box>
  );
}
