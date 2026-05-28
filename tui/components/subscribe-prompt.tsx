import { Box, Text, useInput } from "ink";
import { useState } from "react";
import type { GalleryConfig } from "../lib/gallery.js";

type Props = {
  config: GalleryConfig | null;
  onDone: () => void;
};

type Step = "email" | "name" | "submitting" | "success" | "error";

export function SubscribePrompt({ config, onDone }: Props) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [step, setStep] = useState<Step>("email");
  const [errorMsg, setErrorMsg] = useState("");
  const accent = config?.accentColor ?? "cyan";

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

    if (step === "email") {
      if (key.return) {
        if (!email.includes("@") || !email.includes(".")) {
          setErrorMsg("Please enter a valid email address.");
          setStep("error");
          return;
        }
        setStep("name");
        return;
      }
      if (key.backspace || key.delete) {
        setEmail((e) => e.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setEmail((e) => e + input);
      }
      return;
    }

    if (step === "name") {
      if (key.return) {
        submit(email, name.trim() || undefined);
        return;
      }
      if (key.backspace || key.delete) {
        setName((n) => n.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setName((n) => n + input);
      }
    }
  });

  async function submit(addr: string, subscriberName?: string) {
    setStep("submitting");
    const apiKey = process.env.BUTTONDOWN_API_KEY;
    if (!apiKey) {
      setErrorMsg("Subscription is not configured.");
      setStep("error");
      return;
    }

    try {
      const body: Record<string, unknown> = {
        email_address: addr,
        tags: [config?.utmSource ?? "mussheum", "ssh"],
        utm_source: config?.utmSource ?? "mussheum",
        utm_medium: "ssh",
        utm_campaign: config?.curationDate ?? "",
        metadata: {
          source: "ssh",
          terminal: process.env.TERM ?? "unknown",
          ...(subscriberName ? { name: subscriberName } : {}),
        },
      };
      if (subscriberName) {
        body.notes = subscriberName;
      }

      const res = await fetch("https://api.buttondown.com/v1/subscribers", {
        method: "POST",
        headers: {
          "Authorization": `Token ${apiKey}`,
          "Content-Type": "application/json",
          "X-Buttondown-Bypass-Firewall": "true",
        },
        body: JSON.stringify(body),
      });

      if (res.ok || res.status === 201) {
        setStep("success");
      } else if (res.status === 400) {
        setStep("success");
      } else {
        const data = await res.json().catch(() => ({}));
        setErrorMsg(data.detail || "Something went wrong. Please try again.");
        setStep("error");
      }
    } catch {
      setErrorMsg("Could not connect. Please try again later.");
      setStep("error");
    }
  }

  if (step === "success") {
    return (
      <Box flexDirection="column" alignItems="center">
        <Text color={accent}>Subscribed! Check your email to confirm.</Text>
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
        <Text dimColor>Subscribing...</Text>
      </Box>
    );
  }

  if (step === "name") {
    return (
      <Box flexDirection="column" alignItems="center">
        <Box>
          <Text dimColor>Name (optional): </Text>
          <Text>{name}</Text>
          <Text color={accent}>█</Text>
        </Box>
        <Text dimColor>Press enter to subscribe, esc to cancel</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" alignItems="center">
      <Box>
        <Text dimColor>Email: </Text>
        <Text>{email}</Text>
        <Text color={accent}>█</Text>
      </Box>
      <Text dimColor>Press enter to continue, esc to cancel</Text>
    </Box>
  );
}
