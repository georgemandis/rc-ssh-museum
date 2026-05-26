import { Box, Text } from "ink";
import { HalfBlockImage } from "ink-picture";
import { useState } from "react";
import type { Artwork, GalleryConfig } from "../lib/gallery.js";
import { useTerminalSize } from "../lib/useTerminalSize.js";
import { AnimatedHalfBlockImage } from "./animated-half-block-image.js";

type Props = {
  artwork: Artwork;
  config: GalleryConfig | null;
};

function addUtm(url: string, config: GalleryConfig | null): string {
  const sep = url.includes("?") ? "&" : "?";
  const params = new URLSearchParams({
    utm_source: config?.utmSource ?? "mussheum",
    utm_medium: config?.utmMedium ?? "ssh",
    utm_campaign: config?.curationDate ?? "",
  });
  return `${url}${sep}${params.toString()}`;
}

function buildLink(url: string, label: string, config: GalleryConfig | null): string {
  const fullUrl = addUtm(url, config);
  return `\x1b]8;;${fullUrl}\x07${label}\x1b]8;;\x07`;
}

function visibleUrl(url: string): string {
  return url.replace(/^https?:\/\//, "");
}

export function ArtworkDetail({ artwork, config }: Props) {
  const { rows, cols } = useTerminalSize();
  const [imageSupported, setImageSupported] = useState(true);
  const accent = config?.accentColor ?? "cyan";

  const imageHeight = Math.max(8, rows - 3);
  const imageWidth = Math.floor(cols / 2);
  const infoWidth = Math.min(Math.floor(cols / 2) - 4, 50);

  const artistLink = artwork.artistUrl
    ? buildLink(artwork.artistUrl, artwork.artist, config)
    : null;

  const imageBox = artwork.hasImage && imageSupported ? (
    <Box height={imageHeight} width={imageWidth}>
      {artwork.isAnimated ? (
        <AnimatedHalfBlockImage
          src={artwork.imagePath}
          height={imageHeight}
          alt={artwork.title}
          onSupportDetected={(supported) => {
            if (!supported) setImageSupported(false);
          }}
        />
      ) : (
        <HalfBlockImage
          src={artwork.imagePath}
          height={imageHeight}
          alt={artwork.title}
          onSupportDetected={(supported) => {
            if (!supported) setImageSupported(false);
          }}
        />
      )}
    </Box>
  ) : (
    <Box height={imageHeight} width={imageWidth} alignItems="center" justifyContent="center">
      <Text dimColor>[no image available]</Text>
    </Box>
  );

  return (
    <Box width={cols} height={rows - 1}>
      <Box flexGrow={1} />
      {imageBox}
      <Box flexDirection="column" width={infoWidth} paddingLeft={2} paddingTop={2}>
        <Text bold>{artwork.title}</Text>
        {artistLink ? (
          <Text>by <Text color={accent}>{artistLink}</Text></Text>
        ) : (
          <Text dimColor>by {artwork.artist}</Text>
        )}
        {artwork.medium && <Text dimColor>{artwork.medium}</Text>}
        {artwork.statement && (
          <>
            {artwork.statement.split("\n\n").map((para, i) => (
              <Box key={i} marginTop={1}>
                <Text italic wrap="wrap">{para}</Text>
              </Box>
            ))}
          </>
        )}
        <Box flexDirection="column" marginTop={1}>
          <Text color={accent}>{buildLink(artwork.url, visibleUrl(artwork.url), config)}</Text>
          {artwork.artistUrl && (
            <Text color={accent}>{buildLink(artwork.artistUrl, visibleUrl(artwork.artistUrl), config)}</Text>
          )}
        </Box>
      </Box>
      <Box flexGrow={1} />
    </Box>
  );
}
