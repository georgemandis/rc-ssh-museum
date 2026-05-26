import { Box, Text, useInput } from "ink";
import { useState } from "react";
import type { GalleryConfig } from "../lib/gallery.js";

type Props = {
  config: GalleryConfig | null;
  onDone: () => void;
};

type Step = "title" | "artist" | "imageUrl" | "statement" | "artistUrl" | "confirm" | "submitting" | "success" | "error";

type FormData = {
  title: string;
  artist: string;
  imageUrl: string;
  statement: string;
  artistUrl: string;
};

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

async function downloadImage(url: string): Promise<{ data: Buffer; ext: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download image: ${res.status}`);
  const contentType = res.headers.get("content-type") ?? "";
  const buffer = Buffer.from(await res.arrayBuffer());

  let ext = ".png";
  if (contentType.includes("gif") || url.toLowerCase().endsWith(".gif")) ext = ".gif";
  else if (contentType.includes("jpeg") || contentType.includes("jpg") || url.toLowerCase().match(/\.jpe?g$/)) ext = ".jpg";
  else if (contentType.includes("webp") || url.toLowerCase().endsWith(".webp")) ext = ".webp";

  return { data: buffer, ext };
}

async function createGitHubPR(
  repo: string,
  token: string,
  form: FormData,
  imageData: Buffer,
  imageExt: string,
): Promise<string> {
  const api = `https://api.github.com/repos/${repo}`;
  const headers = {
    Authorization: `token ${token}`,
    Accept: "application/vnd.github.v3+json",
    "Content-Type": "application/json",
  };

  // Get default branch SHA
  const repoRes = await fetch(api, { headers });
  if (!repoRes.ok) throw new Error(`Cannot access repo: ${repoRes.status}`);
  const repoData = await repoRes.json() as { default_branch: string };
  const defaultBranch = repoData.default_branch;

  const refRes = await fetch(`${api}/git/ref/heads/${defaultBranch}`, { headers });
  if (!refRes.ok) throw new Error(`Cannot get branch ref: ${refRes.status}`);
  const refData = await refRes.json() as { object: { sha: string } };
  const baseSha = refData.object.sha;

  // Create branch
  const slug = slugify(form.title);
  const branchName = `submission/${slug}-${Date.now()}`;
  const branchRes = await fetch(`${api}/git/refs`, {
    method: "POST",
    headers,
    body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: baseSha }),
  });
  if (!branchRes.ok) throw new Error(`Cannot create branch: ${branchRes.status}`);

  // Create meta.json blob
  const meta = {
    title: form.title,
    artist: form.artist,
    statement: form.statement || undefined,
    url: form.imageUrl,
    artistUrl: form.artistUrl || undefined,
    dateAdded: new Date().toISOString().split("T")[0],
  };
  const metaBlob = await fetch(`${api}/git/blobs`, {
    method: "POST",
    headers,
    body: JSON.stringify({ content: JSON.stringify(meta, null, 2) + "\n", encoding: "utf-8" }),
  });
  if (!metaBlob.ok) throw new Error(`Cannot create meta blob: ${metaBlob.status}`);
  const metaBlobData = await metaBlob.json() as { sha: string };

  // Create image blob
  const imgBlob = await fetch(`${api}/git/blobs`, {
    method: "POST",
    headers,
    body: JSON.stringify({ content: imageData.toString("base64"), encoding: "base64" }),
  });
  if (!imgBlob.ok) throw new Error(`Cannot create image blob: ${imgBlob.status}`);
  const imgBlobData = await imgBlob.json() as { sha: string };

  // Create tree
  const artFilename = `art${imageExt}`;
  const treePath = `gallery/${slug}`;
  const tree = await fetch(`${api}/git/trees`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      base_tree: baseSha,
      tree: [
        { path: `${treePath}/meta.json`, mode: "100644", type: "blob", sha: metaBlobData.sha },
        { path: `${treePath}/${artFilename}`, mode: "100644", type: "blob", sha: imgBlobData.sha },
      ],
    }),
  });
  if (!tree.ok) throw new Error(`Cannot create tree: ${tree.status}`);
  const treeData = await tree.json() as { sha: string };

  // Create commit
  const commit = await fetch(`${api}/git/commits`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      message: `Add submission: "${form.title}" by ${form.artist}`,
      tree: treeData.sha,
      parents: [baseSha],
    }),
  });
  if (!commit.ok) throw new Error(`Cannot create commit: ${commit.status}`);
  const commitData = await commit.json() as { sha: string };

  // Update branch ref
  await fetch(`${api}/git/refs/heads/${branchName}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ sha: commitData.sha }),
  });

  // Create PR
  const pr = await fetch(`${api}/pulls`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      title: `Submission: "${form.title}" by ${form.artist}`,
      body: [
        `**Title:** ${form.title}`,
        `**Artist:** ${form.artist}`,
        form.statement ? `**Statement:** ${form.statement}` : null,
        form.artistUrl ? `**Artist URL:** ${form.artistUrl}` : null,
        `**Image:** ${form.imageUrl}`,
        "",
        "_Submitted via SSH gallery TUI_",
      ].filter(Boolean).join("\n"),
      head: branchName,
      base: defaultBranch,
    }),
  });
  if (!pr.ok) throw new Error(`Cannot create PR: ${pr.status}`);
  const prData = await pr.json() as { html_url: string };

  return prData.html_url;
}

export function SubmitPrompt({ config, onDone }: Props) {
  const [step, setStep] = useState<Step>("title");
  const [form, setForm] = useState<FormData>({
    title: "",
    artist: "",
    imageUrl: "",
    statement: "",
    artistUrl: "",
  });
  const [errorMsg, setErrorMsg] = useState("");
  const [prUrl, setPrUrl] = useState("");
  const accent = config?.accentColor ?? "cyan";

  const currentField = (): keyof FormData | null => {
    if (step === "title") return "title";
    if (step === "artist") return "artist";
    if (step === "imageUrl") return "imageUrl";
    if (step === "statement") return "statement";
    if (step === "artistUrl") return "artistUrl";
    return null;
  };

  useInput((input, key) => {
    if (step === "success" || step === "error") {
      onDone();
      return;
    }
    if (step === "submitting") return;

    if (key.escape) {
      onDone();
      return;
    }

    if (step === "confirm") {
      if (key.return || input === "y") {
        doSubmit();
      } else if (input === "n") {
        onDone();
      }
      return;
    }

    const field = currentField();
    if (!field) return;

    if (key.return) {
      // Validate required fields
      if (field === "title" && !form.title.trim()) return;
      if (field === "artist" && !form.artist.trim()) return;
      if (field === "imageUrl" && !form.imageUrl.trim()) return;

      // Advance to next step
      const order: Step[] = ["title", "artist", "imageUrl", "statement", "artistUrl", "confirm"];
      const idx = order.indexOf(step);
      setStep(order[idx + 1]);
      return;
    }

    if (key.backspace || key.delete) {
      setForm((f) => ({ ...f, [field]: f[field].slice(0, -1) }));
      return;
    }

    if (input && input.length === 1 && !key.ctrl && !key.meta) {
      setForm((f) => ({ ...f, [field]: f[field] + input }));
    }
  });

  async function doSubmit() {
    setStep("submitting");
    const token = process.env.GITHUB_TOKEN;
    const repo = config?.submitRepo;

    if (!token || !repo) {
      setErrorMsg("GitHub submissions are not configured.");
      setStep("error");
      return;
    }

    try {
      // Download image
      const { data: imageData, ext } = await downloadImage(form.imageUrl.trim());

      // Create PR
      const url = await createGitHubPR(repo, token, form, imageData, ext);
      setPrUrl(url);
      setStep("success");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong.");
      setStep("error");
    }
  }

  if (step === "success") {
    return (
      <Box flexDirection="column" alignItems="center">
        <Text color={accent}>Submission received! A pull request has been opened.</Text>
        {prUrl && <Text dimColor>{prUrl}</Text>}
        <Text dimColor>Press any key to continue.</Text>
      </Box>
    );
  }

  if (step === "error") {
    return (
      <Box flexDirection="column" alignItems="center">
        <Text color="red">{errorMsg}</Text>
        <Text dimColor>Press any key to go back.</Text>
      </Box>
    );
  }

  if (step === "submitting") {
    return (
      <Box>
        <Text dimColor>Downloading image and creating pull request...</Text>
      </Box>
    );
  }

  if (step === "confirm") {
    return (
      <Box flexDirection="column" alignItems="center">
        <Text bold color={accent}>Review your submission:</Text>
        <Text> </Text>
        <Text>Title: <Text bold>{form.title}</Text></Text>
        <Text>Artist: <Text bold>{form.artist}</Text></Text>
        <Text>Image: <Text dimColor>{form.imageUrl}</Text></Text>
        {form.statement && <Text>Statement: <Text dimColor>{form.statement}</Text></Text>}
        {form.artistUrl && <Text>Artist URL: <Text dimColor>{form.artistUrl}</Text></Text>}
        <Text> </Text>
        <Text dimColor>Press enter to submit, n to cancel</Text>
      </Box>
    );
  }

  const field = currentField()!;
  const labels: Record<string, { label: string; required: boolean }> = {
    title: { label: "Title", required: true },
    artist: { label: "Artist name", required: true },
    imageUrl: { label: "Image URL", required: true },
    statement: { label: "Statement (optional)", required: false },
    artistUrl: { label: "Artist URL (optional)", required: false },
  };
  const { label, required } = labels[field];

  return (
    <Box flexDirection="column" alignItems="center">
      <Text bold color={accent}>Submit artwork</Text>
      <Text> </Text>
      <Box>
        <Text dimColor>{label}: </Text>
        <Text>{form[field]}</Text>
        <Text color={accent}>█</Text>
      </Box>
      <Text dimColor>
        {required ? "Press enter to continue, esc to cancel" : "Press enter to skip/continue, esc to cancel"}
      </Text>
    </Box>
  );
}
