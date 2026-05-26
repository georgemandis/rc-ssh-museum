import { Box, useApp, useInput } from "ink";
import { useState, useCallback, useEffect } from "react";
import { useTerminalSize } from "./lib/useTerminalSize.js";
import { Splash } from "./components/splash.js";
import { GalleryList } from "./components/gallery-list.js";
import { ArtworkDetail } from "./components/artwork-detail.js";
import { ExitScreen } from "./components/exit-screen.js";
import { Footer } from "./components/footer.js";
import { ClosedScreen } from "./components/closed-screen.js";
import { ArchiveScreen } from "./components/archive-screen.js";
import { SubscribePrompt } from "./components/subscribe-prompt.js";
import { SubmitPrompt } from "./components/submit-prompt.js";
import { loadGallery, loadCuratorNote, loadGalleryConfig, loadArchive, checkGalleryHours, type Artwork, type CuratorNote, type GalleryConfig, type GalleryStatus, type ArchivedExhibition } from "./lib/gallery.js";
import { join, dirname } from "path";
import { readFile } from "fs/promises";

type Screen =
  | { type: "splash" }
  | { type: "closed" }
  | { type: "list" }
  | { type: "detail"; index: number }
  | { type: "archive" }
  | { type: "exit" };

type Props = {
  userKey: string;
};

export function App({ userKey }: Props) {
  const { exit } = useApp();
  const { rows, cols } = useTerminalSize();
  const [screen, setScreen] = useState<Screen>({ type: "splash" });
  const [artworks, setArtworks] = useState<Artwork[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [visitorCount, setVisitorCount] = useState<number | null>(null);
  const [curatorNote, setCuratorNote] = useState<CuratorNote | null>(null);
  const [config, setConfig] = useState<GalleryConfig | null>(null);
  const [galleryStatus, setGalleryStatus] = useState<GalleryStatus | null>(null);
  const [archive, setArchive] = useState<ArchivedExhibition[]>([]);
  const [subscribing, setSubscribing] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const baseDir = join(dirname(process.argv[1] ?? "."), "..");

  // Load gallery from disk on mount
  useEffect(() => {
    const galleryDir = join(baseDir, "gallery");
    loadGalleryConfig(galleryDir).then((cfg) => {
      setConfig(cfg);
      setGalleryStatus(checkGalleryHours(cfg));
      loadGallery(galleryDir, cfg.sortOrder).then((items) => {
        if (items.length === 0) {
          setLoadError("No artwork found in gallery.");
        } else {
          setArtworks(items);
        }
      });
    });
    loadCuratorNote(galleryDir).then(setCuratorNote);
    loadArchive(galleryDir).then(setArchive);
  }, []);

  useInput((input, key) => {
    if (subscribing || submitting) return;
    if (screen.type === "splash" || screen.type === "exit") return;

    if (screen.type === "closed") {
      if (input === "q") exit();
      if (input === "s" && config?.subscribeEnabled !== false) setSubscribing(true);
      if (input === "u" && config?.submitMethod === "github-pr") setSubmitting(true);
      return;
    }

    if (screen.type === "list") {
      if (input === "q") setScreen({ type: "exit" });
      if (input === "a" && archive.length > 0) setScreen({ type: "archive" });
      if (input === "s" && config?.subscribeEnabled !== false) setSubscribing(true);
      if (input === "u" && config?.submitMethod === "github-pr") setSubmitting(true);
    }

    if (screen.type === "archive") {
      if (input === "b" || input === "q" || key.escape) {
        setScreen({ type: "list" });
      }
      return;
    }

    if (screen.type === "detail") {
      if (input === "b" || input === "q" || key.escape) {
        setScreen({ type: "list" });
      } else if (key.leftArrow && screen.index > 0) {
        setScreen({ type: "detail", index: screen.index - 1 });
      } else if (key.rightArrow && screen.index < artworks.length - 1) {
        setScreen({ type: "detail", index: screen.index + 1 });
      }
    }
  });

  // Poll visitor count file every 3 seconds
  useEffect(() => {
    const countFile = join(baseDir, "visitors.count");
    const poll = () => {
      readFile(countFile, "utf-8")
        .then((s) => setVisitorCount(parseInt(s.trim(), 10) || 0))
        .catch(() => {}); // file may not exist in dev mode
    };
    poll();
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [baseDir]);

  // Single transition mechanism: wait 2s after gallery loads, then show list (or closed screen)
  useEffect(() => {
    if (screen.type === "splash" && artworks.length > 0 && galleryStatus) {
      const next = galleryStatus.open ? "list" : "closed";
      const t = setTimeout(() => setScreen({ type: next }), 2000);
      return () => clearTimeout(t);
    }
  }, [screen.type, artworks.length, galleryStatus]);

  const handleSelect = useCallback((index: number) => {
    setScreen({ type: "detail", index });
  }, []);

  // Auto-exit after showing exit screen
  useEffect(() => {
    if (screen.type === "exit") {
      const t = setTimeout(() => exit(), 3000);
      return () => clearTimeout(t);
    }
  }, [screen.type]);

  if (screen.type === "splash") {
    if (!config) return null;
    return <Splash error={loadError} config={config} />;
  }

  if (screen.type === "closed" && galleryStatus && !galleryStatus.open) {
    if (subscribing) {
      return (
        <Box flexDirection="column" height={rows} width={cols} alignItems="center" justifyContent="center">
          <SubscribePrompt config={config} onDone={() => setSubscribing(false)} />
        </Box>
      );
    }
    if (submitting) {
      return (
        <Box flexDirection="column" height={rows} width={cols} alignItems="center" justifyContent="center">
          <SubmitPrompt config={config} onDone={() => setSubmitting(false)} />
        </Box>
      );
    }
    return <ClosedScreen config={config} status={galleryStatus} onOpen={() => setScreen({ type: "list" })} />;
  }

  if (screen.type === "archive") {
    return <ArchiveScreen archive={archive} config={config} onBack={() => setScreen({ type: "list" })} />;
  }

  if (screen.type === "exit") {
    return <ExitScreen config={config} />;
  }

  const detailIndex = screen.type === "detail" ? screen.index : -1;
  const prevTitle = detailIndex > 0 ? artworks[detailIndex - 1]?.title : null;
  const nextTitle = detailIndex < artworks.length - 1 ? artworks[detailIndex + 1]?.title : null;

  return (
    <Box flexDirection="column" height={rows} width={cols}>
      {screen.type === "list" && !subscribing && !submitting && (
        <>
          <Box flexGrow={1} />
          <Box justifyContent="center" flexGrow={2}>
            <GalleryList artworks={artworks} onSelect={handleSelect} visitorCount={visitorCount} curatorNote={curatorNote} config={config} />
          </Box>
          <Box flexGrow={1} />
        </>
      )}
      {screen.type === "list" && subscribing && (
        <Box flexGrow={1} alignItems="center" justifyContent="center">
          <SubscribePrompt config={config} onDone={() => setSubscribing(false)} />
        </Box>
      )}
      {screen.type === "list" && submitting && (
        <Box flexGrow={1} alignItems="center" justifyContent="center">
          <SubmitPrompt config={config} onDone={() => setSubmitting(false)} />
        </Box>
      )}
      {screen.type === "detail" && (
        <Box flexGrow={1}>
          <ArtworkDetail
            key={artworks[screen.index].slug}
            artwork={artworks[screen.index]}
            config={config}
          />
        </Box>
      )}

      <Footer screen={screen.type === "detail" ? "detail" : "list"} config={config} prevTitle={prevTitle} nextTitle={nextTitle} hasArchive={archive.length > 0} />
    </Box>
  );
}
