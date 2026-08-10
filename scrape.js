function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function buildTree(children) {
  const comments = [];

  for (const child of children) {
    if (child.kind !== "t1") continue;

    const data = child.data;
    if (!data || !data.body) continue;

    const created = new Date(data.created_utc * 1000).toISOString().slice(0, 10);
    const node = { id: data.id, created, body: data.body, replies: [] };

    const replies = data.replies;
    if (replies && typeof replies === "object" && replies.data && replies.data.children) {
      node.replies = buildTree(replies.data.children);
    }

    comments.push(node);
  }

  return comments;
}

async function scrape(threadUrl, cookie, limit) {
  limit = limit || 1500;
  const base = threadUrl.replace(/\/?$/, "/") + ".json";
  const headers = {
    "User-Agent": "node:reddit-scraper:v1.0 (by /u/example)"
  };
  if (cookie) {
    headers["Cookie"] = cookie;
  }

  const allChildren = [];
  let after = null;
  let page = 0;

  while (true) {
    const params = new URLSearchParams({ limit: String(limit) });
    if (after) params.append("after", after);
    const url = `${base}?${params}`;

    const res = await fetch(url, { headers });
    if (!res.ok) {
      throw new Error(`Reddit returned ${res.status}: ${res.statusText}`);
    }

    const json = await res.json();
    const listing = json[1];
    if (!listing || !listing.data) break;

    const children = listing.data.children;
    if (!children || children.length === 0) break;

    allChildren.push(...children);
    after = listing.data.after;

    page++;
    if (!after) break;
    await sleep(200);
  }

  return buildTree(allChildren);
}

module.exports = { scrape };
