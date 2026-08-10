async function prompt(text, baseUrl, model, apiKey) {
  const headers = { "Content-Type": "application/json" };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: text }]
    })
  });

  if (!res.ok) {
    throw new Error(`LLM API returned ${res.status}: ${res.statusText}`);
  }

  const json = await res.json();
  return json.choices[0].message.content;
}

module.exports = { prompt };
