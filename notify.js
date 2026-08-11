"use strict";

const NTFY_TIMEOUT = 15000;
let lastNtfyFail = 0;

async function send(ntfyUrl, message, { title, priority, tags, auth } = {}) {
  if (!ntfyUrl) return;

  if (lastNtfyFail && Date.now() - lastNtfyFail < 300000) {
    console.log(`[ntfy] suppressed: ${title || message.slice(0, 60)}`);
    return;
  }

  const headers = {};
  if (title) headers["Title"] = title;
  if (priority !== undefined) headers["Priority"] = String(priority);
  if (tags) headers["Tags"] = tags;
  if (auth) headers["Authorization"] = auth;

  const urlLabel = ntfyUrl.replace(/\/[^/]+$/, "/***");
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), NTFY_TIMEOUT);

  try {
    const res = await fetch(ntfyUrl, {
      method: "POST",
      headers,
      body: message,
      signal: ac.signal
    });
    clearTimeout(timer);
    if (!res.ok) {
      lastNtfyFail = Date.now();
      console.error(`[ntfy] ${urlLabel}: ${res.status} ${res.statusText}`);
    }
  } catch (err) {
    clearTimeout(timer);
    lastNtfyFail = Date.now();
    if (err.name === "AbortError") {
      console.error(`[ntfy] ${urlLabel}: timed out after ${NTFY_TIMEOUT / 1000}s`);
    } else {
      console.error(`[ntfy] ${urlLabel}: ${err.message}`);
    }
  }
}

module.exports = { send };
