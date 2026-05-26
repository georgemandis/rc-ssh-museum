# mussheum submission notification worker

A Cloudflare Worker that emails you when a new artwork submission arrives in R2.

## How it works

1. Artist submits via `ssh your-host submit < submission.zip`
2. The Go server validates and uploads to Cloudflare R2
3. R2 fires an `object-create` event notification to a Cloudflare Queue
4. This worker consumes the queue, reads the submission's `meta.json` from R2, and sends an email with the full details and the zip attached

## Email contents

- Subject: `New submission: "Title" by Artist`
- Body: title, artist, statement, URLs, email, R2 paths
- Attachment: the original `submission.zip`

## Setup

Requires [Wrangler](https://developers.cloudflare.com/workers/wrangler/) and Cloudflare Email Routing enabled on your domain.

```bash
cd worker

# Install dependencies
npm install

# Create the queue
npx wrangler queues create mussheum-submissions

# Add R2 event notification (fires on meta.json uploads)
npx wrangler r2 bucket notification create your-submissions-bucket \
  --event-type object-create \
  --queue mussheum-submissions \
  --suffix meta.json

# Update wrangler.toml with your bucket name, email addresses, etc.

# Deploy
npx wrangler deploy
```

## Configuration

Edit `wrangler.toml` to set:
- `destination_address` in `[[send_email]]` — where notifications go
- `bucket_name` in `[[r2_buckets]]` — your R2 bucket
- `queue` in `[[queues.consumers]]` — your queue name
