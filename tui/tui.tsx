import { render } from "ink";
import { TerminalInfoProvider } from "ink-picture";
import { parseArgs } from "util";
import { App } from "./app.js";
import { loadGalleryConfig } from "./lib/gallery.js";
import { join, dirname } from "path";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    "user-key": { type: "string" },
    "auth-url": { type: "string" },
  },
});

const userKey = values["user-key"] ?? "anonymous";
const authUrl = values["auth-url"] ?? undefined;
const baseDir = join(dirname(process.argv[1] ?? "."), "..");
const galleryDir = join(baseDir, "gallery");

const config = await loadGalleryConfig(galleryDir);

const { waitUntilExit } = render(
  <TerminalInfoProvider>
    <App userKey={userKey} authUrl={authUrl} />
  </TerminalInfoProvider>,
  { alternateScreen: true },
);

await waitUntilExit();

// Print persistent goodbye message after the alternate screen closes
const name = config.name ?? "mussheum";
const dim = "\x1b[2m";
const reset = "\x1b[0m";
const bold = "\x1b[1m";

let message = `\n${dim}Thank you for visiting ${reset}${bold}${name}${reset}${dim}.${reset}`;

if (config.exhibition) {
  message += `\n${dim}${config.exhibition}${reset}`;
}

if (config.newsletterUrl) {
  const cta = config.newsletterCta ?? "Sign up for updates on our next exhibition";
  const visibleUrl = config.newsletterUrl.replace(/^https?:\/\//, "");
  const link = `\x1b]8;;${config.newsletterUrl}\x07${visibleUrl}\x1b]8;;\x07`;
  message += `\n${dim}${cta}:${reset}\n${link}`;
}

if (config.submissionsUrl) {
  const cta = config.submissionsCta ?? "Interested in showing your work?";
  const visibleUrl = config.submissionsUrl.replace(/^https?:\/\//, "");
  const link = `\x1b]8;;${config.submissionsUrl}\x07${visibleUrl}\x1b]8;;\x07`;
  message += `\n${dim}${cta}${reset}\n${link}`;
}

message += "\n";
process.stdout.write(message);
