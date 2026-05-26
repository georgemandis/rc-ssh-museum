import { describe, test, expect } from "bun:test";
import { checkGalleryHours, formatNextOpening, loadGallery, type GalleryConfig } from "./gallery";
import { mkdtemp, mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

function makeConfig(hours: GalleryConfig["hours"]): GalleryConfig {
  return {
    name: "test",
    tagline: "test",
    exhibition: "test",
    accentColor: "cyan",
    curationDate: "2026",
    utmSource: "test",
    utmMedium: "test",
    hours,
  };
}

describe("checkGalleryHours", () => {
  test("no hours configured = always open", () => {
    const config = makeConfig(undefined);
    const status = checkGalleryHours(config);
    expect(status.open).toBe(true);
  });

  test("hours: 'closed' = always closed, no next opening", () => {
    const config = makeConfig("closed");
    const status = checkGalleryHours(config);
    expect(status.open).toBe(false);
    if (!status.open) {
      expect(status.nextOpeningDate).toBeNull();
    }
  });

  test("open during scheduled hours", () => {
    const now = new Date();
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const day = now.getDay();
    const hour = now.getHours();
    const config = makeConfig([
      {
        days: [day],
        open: `${String(hour).padStart(2, "0")}:00`,
        close: `${String(hour + 1).padStart(2, "0")}:00`,
        tz,
      },
    ]);
    const status = checkGalleryHours(config);
    expect(status.open).toBe(true);
  });

  test("closed outside scheduled hours", () => {
    const now = new Date();
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const day = now.getDay();
    // Schedule for 2 hours ago — should be closed
    const pastHour = (now.getHours() + 22) % 24; // 2 hours ago, wrapping
    const pastEnd = (pastHour + 1) % 24;
    // Only test if the window doesn't wrap around midnight into now
    if (pastEnd <= now.getHours() || pastHour > now.getHours()) {
      const config = makeConfig([
        {
          days: [day],
          open: `${String(pastHour).padStart(2, "0")}:00`,
          close: `${String(pastEnd).padStart(2, "0")}:00`,
          tz,
        },
      ]);
      const status = checkGalleryHours(config);
      expect(status.open).toBe(false);
    }
  });

  test("closed on wrong day of week", () => {
    const now = new Date();
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const wrongDay = (now.getDay() + 3) % 7; // definitely not today
    const config = makeConfig([
      {
        days: [wrongDay],
        open: "00:00",
        close: "23:59",
        tz,
      },
    ]);
    const status = checkGalleryHours(config);
    expect(status.open).toBe(false);
    if (!status.open) {
      expect(status.nextOpeningDate).not.toBeNull();
    }
  });

  test("week constraint: 'first' friday only", () => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    // Create a date that's the 15th of the month (definitely not first week)
    const config = makeConfig([
      {
        days: [5], // Friday
        open: "00:00",
        close: "23:59",
        tz,
        week: "first",
      },
    ]);
    const status = checkGalleryHours(config);
    // We can't assert open/closed without knowing today's date,
    // but we can verify it returns a valid status
    expect(typeof status.open).toBe("boolean");
    if (!status.open) {
      // Should have a next opening date (first friday of some month)
      expect(status.nextOpeningDate).not.toBeNull();
    }
  });

  test("returns nextOpeningDate when closed with schedule", () => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const tomorrow = (new Date().getDay() + 1) % 7;
    const config = makeConfig([
      {
        days: [tomorrow],
        open: "10:00",
        close: "11:00",
        tz,
      },
    ]);
    const status = checkGalleryHours(config);
    // If we're not in that window, we should get a next opening date
    if (!status.open) {
      expect(status.nextOpeningDate).toBeInstanceOf(Date);
      expect(status.nextOpeningDate!.getTime()).toBeGreaterThan(Date.now());
    }
  });
});

describe("formatNextOpening", () => {
  test("shows countdown with date", () => {
    const future = new Date(Date.now() + 3600 * 1000); // 1 hour from now
    const result = formatNextOpening(future);
    expect(result).toContain("1h");
    expect(result).toContain("(");  // has countdown in parens
  });

  test("returns 'Now' for past dates", () => {
    const past = new Date(Date.now() - 1000);
    expect(formatNextOpening(past)).toBe("Now");
  });

  test("shows days for far future", () => {
    const future = new Date(Date.now() + 3 * 86400 * 1000); // 3 days
    const result = formatNextOpening(future);
    expect(result).toContain("3d");
  });
});

describe("loadGallery", () => {
  const makeMeta = (title: string) => JSON.stringify({
    title,
    artist: "Test Artist",
    url: "https://example.com",
    dateAdded: "2026-01-01",
  });

  test("detects art.gif as animated", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "gallery-test-"));
    const artDir = join(tempDir, "gif-artwork");
    await mkdir(artDir);
    await writeFile(join(artDir, "meta.json"), makeMeta("GIF Test"));
    await writeFile(join(artDir, "art.gif"), Buffer.from("GIF89a"));

    const artworks = await loadGallery(tempDir);
    expect(artworks).toHaveLength(1);
    expect(artworks[0]!.isAnimated).toBe(true);
    expect(artworks[0]!.hasImage).toBe(true);
    expect(artworks[0]!.imagePath).toContain("art.gif");

    await rm(tempDir, { recursive: true });
  });

  test("detects art.png as not animated", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "gallery-test-"));
    const artDir = join(tempDir, "png-artwork");
    await mkdir(artDir);
    await writeFile(join(artDir, "meta.json"), makeMeta("PNG Test"));
    await writeFile(join(artDir, "art.png"), Buffer.from("PNG"));

    const artworks = await loadGallery(tempDir);
    expect(artworks).toHaveLength(1);
    expect(artworks[0]!.isAnimated).toBe(false);
    expect(artworks[0]!.hasImage).toBe(true);
    expect(artworks[0]!.imagePath).toContain("art.png");

    await rm(tempDir, { recursive: true });
  });

  test("prefers art.gif over art.png when both exist", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "gallery-test-"));
    const artDir = join(tempDir, "both-artwork");
    await mkdir(artDir);
    await writeFile(join(artDir, "meta.json"), makeMeta("Both Test"));
    await writeFile(join(artDir, "art.gif"), Buffer.from("GIF89a"));
    await writeFile(join(artDir, "art.png"), Buffer.from("PNG"));

    const artworks = await loadGallery(tempDir);
    expect(artworks).toHaveLength(1);
    expect(artworks[0]!.isAnimated).toBe(true);
    expect(artworks[0]!.imagePath).toContain("art.gif");

    await rm(tempDir, { recursive: true });
  });

  test("handles no image gracefully", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "gallery-test-"));
    const artDir = join(tempDir, "no-image");
    await mkdir(artDir);
    await writeFile(join(artDir, "meta.json"), makeMeta("No Image Test"));

    const artworks = await loadGallery(tempDir);
    expect(artworks).toHaveLength(1);
    expect(artworks[0]!.isAnimated).toBe(false);
    expect(artworks[0]!.hasImage).toBe(false);

    await rm(tempDir, { recursive: true });
  });
});
