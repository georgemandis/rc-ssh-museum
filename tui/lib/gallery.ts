import { readdir, readFile } from "fs/promises";
import { join, dirname } from "path";

export type ArtworkMeta = {
  title: string;
  artist: string;
  statement?: string;
  medium?: string;
  url: string;
  artistUrl?: string;
  dateAdded: string;
};

export type Artwork = ArtworkMeta & {
  slug: string;
  imagePath: string;
  hasImage: boolean;
  isAnimated: boolean;
};

export type CuratorNote = {
  date: string;
  note: string;
};

export type ArchivedPiece = {
  title: string;
  artist: string;
};

export type ArchivedExhibition = {
  exhibition: string;
  pieces: ArchivedPiece[];
};

export async function loadArchive(galleryDir: string): Promise<ArchivedExhibition[]> {
  try {
    const raw = await readFile(join(galleryDir, "archive.json"), "utf-8");
    const data = JSON.parse(raw);
    if (Array.isArray(data)) return data;
    return [];
  } catch {
    return [];
  }
}

// days: 0=Sunday, 1=Monday, ..., 6=Saturday
// week: optional — "first", "second", "third", "fourth", "last" to restrict to that occurrence in the month
export type HoursRule = {
  days: number[];
  open: string;   // "HH:MM" in 24h format
  close: string;  // "HH:MM" in 24h format
  tz: string;     // IANA timezone, e.g. "America/New_York"
  week?: "first" | "second" | "third" | "fourth" | "last";
};

export type GalleryConfig = {
  name: string;
  tagline: string;
  exhibition: string;
  accentColor: string;
  secondaryColor: string;
  curationDate: string;
  utmSource: string;
  utmMedium: string;
  newsletterUrl?: string;
  newsletterCta?: string;
  submissionsUrl?: string;
  submissionsCta?: string;
  hours?: HoursRule[] | "closed";
  subscribeEnabled?: boolean;
  sortOrder?: "newest" | "oldest" | "title" | "artist" | "random";
  splash?: "bigtext" | "logo" | "ascii" | "image";
  submitMethod?: "github-pr";
  submitRepo?: string;
};

const defaultConfig: GalleryConfig = {
  name: "mussheum",
  tagline: "an ssh art gallery",
  exhibition: "Example Exhibition",
  accentColor: "cyan",
  secondaryColor: "magenta",
  curationDate: "",
  utmSource: "mussheum",
  utmMedium: "ssh",
};

export async function loadGalleryConfig(galleryDir: string): Promise<GalleryConfig> {
  try {
    const raw = await readFile(join(galleryDir, "config.json"), "utf-8");
    const data = JSON.parse(raw);
    return { ...defaultConfig, ...data };
  } catch {
    return defaultConfig;
  }
}

export async function loadCuratorNote(galleryDir: string): Promise<CuratorNote | null> {
  try {
    const raw = await readFile(join(galleryDir, "curator-note.md"), "utf-8");
    const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) return null;
    const frontmatter = match[1];
    const body = match[2].trim();
    const dateMatch = frontmatter.match(/^date:\s*(.+)$/m);
    if (!dateMatch || !body) return null;
    return { date: dateMatch[1].trim(), note: body };
  } catch {
    return null;
  }
}

export async function loadGallery(galleryDir: string, sortOrder?: GalleryConfig["sortOrder"]): Promise<Artwork[]> {
  let entries: import("fs").Dirent[];
  try {
    entries = await readdir(galleryDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const artworks: Artwork[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const slug = entry.name;
    const metaPath = join(galleryDir, slug, "meta.json");
    try {
      const raw = await readFile(metaPath, "utf-8");
      const meta: ArtworkMeta = JSON.parse(raw);

      // Validate required fields
      if (!meta.title || !meta.artist || !meta.url || !meta.dateAdded) {
        console.error(`Skipping ${slug}: missing required fields in meta.json`);
        continue;
      }

      // Check for art.gif first, then art.png
      let imagePath = join(galleryDir, slug, "art.gif");
      let hasImage = false;
      let isAnimated = false;
      try {
        await readFile(imagePath, { flag: "r" });
        hasImage = true;
        isAnimated = true;
      } catch {
        // No gif, try png
        imagePath = join(galleryDir, slug, "art.png");
        try {
          await readFile(imagePath, { flag: "r" });
          hasImage = true;
        } catch {
          // No image — that's fine, we'll show metadata only
        }
      }

      artworks.push({ ...meta, slug, imagePath, hasImage, isAnimated });
    } catch (err) {
      console.error(`Skipping ${slug}: ${err}`);
    }
  }

  const order = sortOrder ?? "newest";
  switch (order) {
    case "oldest":
      artworks.sort((a, b) => a.dateAdded.localeCompare(b.dateAdded));
      break;
    case "title":
      artworks.sort((a, b) => a.title.localeCompare(b.title));
      break;
    case "artist":
      artworks.sort((a, b) => a.artist.localeCompare(b.artist));
      break;
    case "random":
      for (let i = artworks.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [artworks[i], artworks[j]] = [artworks[j], artworks[i]];
      }
      break;
    case "newest":
    default:
      artworks.sort((a, b) => b.dateAdded.localeCompare(a.dateAdded));
      break;
  }
  return artworks;
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function getWeekOccurrence(date: Date): number {
  return Math.ceil(date.getDate() / 7);
}

function isLastOccurrenceInMonth(date: Date): boolean {
  const nextWeek = new Date(date);
  nextWeek.setDate(nextWeek.getDate() + 7);
  return nextWeek.getMonth() !== date.getMonth();
}

function matchesWeekConstraint(date: Date, week: HoursRule["week"]): boolean {
  if (!week) return true;
  if (week === "last") return isLastOccurrenceInMonth(date);
  const occurrence = getWeekOccurrence(date);
  const map = { first: 1, second: 2, third: 3, fourth: 4 };
  return occurrence === map[week];
}

function matchesRule(rule: HoursRule, now: Date): boolean {
  const localStr = now.toLocaleString("en-US", { timeZone: rule.tz });
  const local = new Date(localStr);
  const day = local.getDay();
  if (!rule.days.includes(day)) return false;
  if (!matchesWeekConstraint(local, rule.week)) return false;
  const minutes = local.getHours() * 60 + local.getMinutes();
  return minutes >= timeToMinutes(rule.open) && minutes < timeToMinutes(rule.close);
}

export type GalleryStatus =
  | { open: true }
  | { open: false; nextOpeningDate: Date | null };

const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function findNextOpeningDate(rule: HoursRule, fromDate: Date): Date | null {
  const localStr = fromDate.toLocaleString("en-US", { timeZone: rule.tz });
  const local = new Date(localStr);

  for (let offset = 0; offset <= 35; offset++) {
    const candidate = new Date(local);
    candidate.setDate(candidate.getDate() + offset);
    candidate.setHours(0, 0, 0, 0);

    const day = candidate.getDay();
    if (!rule.days.includes(day)) continue;
    if (!matchesWeekConstraint(candidate, rule.week)) continue;

    if (offset === 0) {
      const nowMinutes = local.getHours() * 60 + local.getMinutes();
      if (nowMinutes >= timeToMinutes(rule.open)) continue;
    }

    // Build the opening time as a Date in the rule's timezone
    const [openH, openM] = rule.open.split(":").map(Number);
    candidate.setHours(openH, openM, 0, 0);

    // Convert back: candidate is in local tz interpretation, compute offset from real UTC
    const utcTarget = new Date(candidate.toLocaleString("en-US", { timeZone: "UTC" }));
    const tzTarget = new Date(candidate.toLocaleString("en-US", { timeZone: rule.tz }));
    const offsetMs = utcTarget.getTime() - tzTarget.getTime();
    return new Date(candidate.getTime() + offsetMs);
  }

  return null;
}

export function formatNextOpening(nextDate: Date, tz?: string): string {
  const now = new Date();
  const diffMs = nextDate.getTime() - now.getTime();

  if (diffMs <= 0) return "Now";

  const totalSeconds = Math.floor(diffMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);

  const countdown = parts.join(" ");

  // Also show the target date/time for context
  // Include month/day when more than 7 days out
  const dateOpts: Intl.DateTimeFormatOptions = {
    weekday: "long",
    ...(days >= 7 ? { month: "long", day: "numeric" } : {}),
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    ...(tz ? { timeZone: tz } : {}),
  };
  const dateStr = nextDate.toLocaleString("en-US", dateOpts);

  return `${dateStr} (${countdown})`;
}

export function checkGalleryHours(config: GalleryConfig): GalleryStatus {
  if (!config.hours) return { open: true };
  if (config.hours === "closed") return { open: false, nextOpeningDate: null };

  const now = new Date();
  for (const rule of config.hours) {
    if (matchesRule(rule, now)) return { open: true };
  }

  // Find the soonest next opening across all rules
  let soonest: Date | null = null;
  for (const rule of config.hours) {
    const candidate = findNextOpeningDate(rule, now);
    if (candidate && (!soonest || candidate.getTime() < soonest.getTime())) {
      soonest = candidate;
    }
  }

  return { open: false, nextOpeningDate: soonest };
}
