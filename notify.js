async function send(ntfyUrl, message, { title, priority, tags, auth } = {}) {
  if (!ntfyUrl) return;

  const headers = {};
  if (title) headers["Title"] = title;
  if (priority !== undefined) headers["Priority"] = String(priority);
  if (tags) headers["Tags"] = tags;
  if (auth) headers["Authorization"] = auth;

  try {
    const res = await fetch(ntfyUrl, {
      method: "POST",
      headers,
      body: message
    });
    if (!res.ok) {
      console.error(`[ntfy] ${ntfyUrl}: ${res.status} ${res.statusText}`);
    }
  } catch (err) {
    console.error(`[ntfy] ${ntfyUrl}: ${err.message}`);
  }
}

module.exports = { send };
