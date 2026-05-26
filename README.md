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

## Environment Variables

| Variable       | Description                                            |
|----------------|--------------------------------------------------------|
| `GITHUB_TOKEN` | GitHub token with Contents + Pull requests write access |
| `TUI_CMD`      | Override TUI command (default: compiled binary)         |

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

Hosted on a Raspberry Pi local to the Recurse Center hub. See `Dockerfile` and `fly.toml` for container setup (adaptable to any Docker host).

## License

MIT
