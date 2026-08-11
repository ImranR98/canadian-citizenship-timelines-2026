"use strict";

const NTFY_TIMEOUT = 15000;

async function send(ntfyUrl, message, { title, priority, tags, auth } = {}) {
  if (!ntfyUrl) return;

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
      console.error(`[ntfy] ${urlLabel}: ${res.status} ${res.statusText}`);
    }
  } catch (err) {
    clearTimeout(timer);
    if (err.name === "AbortError") {
      console.error(`[ntfy] ${urlLabel}: timed out after ${NTFY_TIMEOUT / 1000}s`);
    } else {
      console.error(`[ntfy] ${urlLabel}: ${err.message}`);
    }
  }
}

module.exports = { send };
