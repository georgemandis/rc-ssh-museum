# RC mussheum

An SSH art gallery for the Recurse Center, built on [mussheum](https://github.com/georgemandis/mussheum).

## Connecting

```bash
ssh your-host.example.com
```

## Submitting Artwork

Press `u` while browsing the gallery to submit artwork directly from the TUI. You'll be prompted for:

- **Title** (required)
- **Artist name** (required)
- **Image URL** (required) -- link to a hosted image (PNG, JPG, GIF, or WebP)
- **Statement** (optional)
- **Artist URL** (optional)

Your submission downloads the image and opens a pull request on this repo for review.

## Configuration

Gallery settings live in `gallery/config.json`:

```json
{
  "name": "RC mussheum",
  "tagline": "an ssh art gallery",
  "exhibition": "The robo GIF collection",
  "accentColor": "greenBright",
  "secondaryColor": "green",
  "subscribeEnabled": false,
  "sortOrder": "newest",
  "splash": "logo",
  "submitMethod": "github-pr",
  "submitRepo": "georgemandis/rc-ssh-museum"
}
```

Key differences from the upstream mussheum:

| Setting              | Value              | Why                                           |
|----------------------|--------------------|-----------------------------------------------|
| `subscribeEnabled`   | `false`            | No Buttondown/Cloudflare email workers         |
| `splash`             | `"logo"`           | Shows `gallery/logo.png` on the splash screen  |
| `submitMethod`       | `"github-pr"`      | Submissions open PRs instead of uploading to S3 |

See the [mussheum README](https://github.com/georgemandis/mussheum) for the full config reference.

## Authentication

Access is restricted to Recurse Center members via RC OAuth. When a user SSHs in with an unrecognized key, the TUI shows a one-time auth URL. The user opens it in a browser, authenticates with their RC account, and their SSH key is permanently approved.

If `RC_OAUTH_CLIENT_ID` is not set, authentication is disabled and everyone can access the gallery.

**RC OAuth app setup:**

1. Register an OAuth app at [recurse.com/settings/apps](https://www.recurse.com/settings/apps)
2. Set the redirect URI to `https://<your-public-url>/auth/callback`
3. Configure the env vars below

Approved keys are persisted to `/data/approved-keys.json` (inside the Disco volume).

## Environment Variables

All env vars are managed via [Disco](https://disco.cloud/) (`disco env:set`).

| Variable                | Required | Description                                            |
|-------------------------|----------|--------------------------------------------------------|
| `RC_OAUTH_CLIENT_ID`    | For auth | RC OAuth app client ID                                 |
| `RC_OAUTH_CLIENT_SECRET`| For auth | RC OAuth app client secret                             |
| `PUBLIC_URL`            | For auth | Public-facing URL (e.g. `https://mussheum.example.com`)|
| `GITHUB_TOKEN`          | For submissions | GitHub token with Contents + Pull requests write access |
| `TUI_CMD`               | No       | Override TUI command (default: compiled binary)         |
| `RC_OAUTH_BASE_URL`     | No       | Defaults to `https://www.recurse.com`                  |

## Development

```bash
# TUI iteration without SSH
cd tui && bun install
bun tui/tui.tsx --user-key=test

# Full build
./build.sh
cd server && ./mussheum-server
```

## Adding Artwork Manually

Each piece lives in its own subdirectory under `gallery/`:

```
gallery/
  my-artwork/
    meta.json
    art.png       # or art.gif
```

`meta.json`:

```json
{
  "title": "Name of the Work",
  "artist": "Your Name",
  "statement": "A few sentences about the work.",
  "url": "https://link-to-the-work.com",
  "artistUrl": "https://your-portfolio.com",
  "dateAdded": "2026-05-26"
}
```

## Deployment

Hosted on a Raspberry Pi local to the Recurse Center hub using [Disco](https://disco.cloud/). See `disco.json` for volume and port configuration.

```bash
# Set env vars
disco env:set RC_OAUTH_CLIENT_ID=... RC_OAUTH_CLIENT_SECRET=... PUBLIC_URL=https://... GITHUB_TOKEN=...

# Deploy
disco deploy
```

The `disco.json` exposes port 2222 (SSH) as port 22 and port 8080 (HTTP for auth + website). A persistent volume at `/data` stores SSH host keys and approved keys.

## License

MIT
