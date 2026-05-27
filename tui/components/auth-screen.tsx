import { Box, Text, useApp } from "ink";
import { useState, useEffect } from "react";
import type { GalleryConfig } from "../lib/gallery.js";
import { useTerminalSize } from "../lib/useTerminalSize.js";

type Props = {
  authUrl: string;
  config: GalleryConfig | null;
  onApproved: (name: string) => void;
};

export function AuthScreen({ authUrl, config, onApproved }: Props) {
  const { rows, cols } = useTerminalSize();
  const { exit } = useApp();
  const accent = config?.accentColor ?? "cyan";
  const name = config?.name ?? "mussheum";
  const [dots, setDots] = useState("");
  const [expired, setExpired] = useState(false);

  // Animate waiting dots
  useEffect(() => {
    const interval = setInterval(() => {
      setDots((d) => (d.length >= 3 ? "" : d + "."));
    }, 500);
    return () => clearInterval(interval);
  }, []);

  // Poll the status endpoint
  useEffect(() => {
    const statusUrl = authUrl + "/status";
    let cancelled = false;

    const poll = async () => {
      while (!cancelled) {
        try {
          const res = await fetch(statusUrl);
          if (res.ok) {
            const data = await res.json() as { approved?: boolean; expired?: boolean; name?: string };
            if (data.approved) {
              onApproved(data.name ?? "");
              return;
            }
            if (data.expired) {
              setExpired(true);
              return;
            }
          }
        } catch {
          // Network error — keep polling
        }
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    };

    poll();
    return () => { cancelled = true; };
  }, [authUrl]);

  const visibleUrl = authUrl.replace(/^https?:\/\//, "");
  const link = `\x1b]8;;${authUrl}\x07${visibleUrl}\x1b]8;;\x07`;

  if (expired) {
    return (
      <Box
        flexDirection="column"
        height={rows}
        width={cols}
        alignItems="center"
        justifyContent="center"
      >
        <Text color="yellow">Your authentication link has expired.</Text>
        <Text dimColor>Please disconnect and SSH in again to get a new link.</Text>
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      height={rows}
      width={cols}
      alignItems="center"
      justifyContent="center"
    >
      <Text bold color={accent}>{name}</Text>
      <Text> </Text>
      <Text>To access the gallery, verify your Recurse Center account.</Text>
      <Text> </Text>
      <Text dimColor>Open this link in your browser:</Text>
      <Text color={accent}>{link}</Text>
      <Text> </Text>
      <Text dimColor>Waiting for authentication{dots}</Text>
      <Text> </Text>
      <Text dimColor>Press q to quit</Text>
    </Box>
  );
}
