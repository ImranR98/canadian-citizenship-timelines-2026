async function prompt(text, baseUrl, model, apiKey) {
  const headers = { "Content-Type": "application/json" };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const fetchStart = Date.now();
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: text }]
    })
  });
  const fetchMs = Date.now() - fetchStart;

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`LLM API returned ${res.status}: ${res.statusText}${body ? " — " + body.slice(0, 200) : ""}`);
  }

  const json = await res.json();
  const totalMs = Date.now() - fetchStart;
  const content = json.choices[0].message.content;
  console.error(`[llm] fetch:${fetchMs}ms total:${totalMs}ms prompt:${text.length}chars resp:${content.length}chars`);

  return content;
}

module.exports = { prompt };
