"use strict";

async function prompt(systemText, userText, baseUrl, model, apiKey) {
  const headers = { "Content-Type": "application/json" };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const messages = [
    { role: "system", content: systemText },
    { role: "user", content: userText }
  ];

  const url = baseUrl.replace(/\/+$/, "") + "/chat/completions";
  const fetchStart = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ model, messages })
  });
  const fetchMs = Date.now() - fetchStart;

  if (!res.ok) {
    throw new Error(`LLM API returned ${res.status}`);
  }

  const json = await res.json();
  if (!json.choices || !json.choices.length) {
    throw new Error("LLM returned empty choices array");
  }
  const totalMs = Date.now() - fetchStart;
  const content = json.choices[0].message.content;
  console.error(`fetch:${fetchMs}ms total:${totalMs}ms total_chars:${systemText.length + userText.length} resp:${content.length}chars`);

  return content;
}

module.exports = { prompt };
