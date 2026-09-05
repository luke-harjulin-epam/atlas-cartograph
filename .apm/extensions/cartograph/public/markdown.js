function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function shortWikiLabel(target) {
  const t = String(target).replace(/\\/g, "/").replace(/\.md$/i, "");
  for (const prefix of [
    "raw/experiences/",
    "raw/articles/",
    "raw/papers/",
    "knowledge/",
    "experiences/",
    "decisions/",
    "work/",
    "lessons/",
    "recipes/",
    "modules/",
  ]) {
    if (t.startsWith(prefix)) return t.slice(prefix.length);
  }
  return t.split("/").pop() || t;
}

function wikiButton(target, label) {
  const t = String(target || "").trim();
  const l = (label || shortWikiLabel(t)).trim() || t;
  return `<button type="button" class="wikilink" data-target="${escapeHtml(t)}">${escapeHtml(l)}</button>`;
}

function mdLink(label, href) {
  const h = String(href || "").trim();
  const l = label || h;
  if (/^https?:\/\//i.test(h) || h.startsWith("mailto:")) {
    return `<a href="${escapeHtml(h)}" target="_blank" rel="noopener noreferrer">${escapeHtml(l)}</a>`;
  }
  if (!h || h.startsWith("#")) return escapeHtml(l);
  return wikiButton(h.replace(/^\.\//, ""), l);
}

function inline(text) {
  const src = String(text ?? "");
  const re =
    /(\[\[([^\]|]+)(?:\|([^\]]+))?\]\])|(\[([^\]]+)\]\(([^)]+)\))|(`[^`]+`)|(\*\*[^*]+\*\*|__[^_]+__)|(\*[^*]+\*|_[^_]+_)/g;
  let last = 0;
  let out = "";
  let m;
  while ((m = re.exec(src))) {
    if (m.index > last) out += escapeHtml(src.slice(last, m.index));
    if (m[1]) out += wikiButton(m[2], m[3]);
    else if (m[4]) out += mdLink(m[5], m[6]);
    else if (m[7]) out += `<code>${escapeHtml(m[7].slice(1, -1))}</code>`;
    else if (m[8]) out += `<strong>${escapeHtml(m[8].slice(2, -2))}</strong>`;
    else if (m[9]) out += `<em>${escapeHtml(m[9].slice(1, -1))}</em>`;
    last = m.index + m[0].length;
  }
  if (last < src.length) out += escapeHtml(src.slice(last));
  return out;
}

function splitCells(row) {
  let s = row.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

function isSepRow(row) {
  const cells = splitCells(row);
  return cells.length > 0 && cells.every((c) => /^:?-{3,}:?$/.test(c));
}

function renderTable(block) {
  const rows = block.split("\n").filter((l) => /^\s*\|/.test(l));
  if (!rows.length) return "";
  let head = splitCells(rows[0]);
  let bodyRows = rows.slice(1);
  if (bodyRows[0] && isSepRow(bodyRows[0])) bodyRows = bodyRows.slice(1);
  const th = head.map((c) => `<th>${inline(c)}</th>`).join("");
  const tr = bodyRows
    .map((row) => `<tr>${splitCells(row).map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
    .join("");
  return `<div class="md-table"><table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`;
}

function listKind(line) {
  if (/^\s*[-*+]\s+/.test(line)) return "ul";
  if (/^\s*\d+\.\s+/.test(line)) return "ol";
  return null;
}

function isStandalone(line) {
  return /^#{1,6}\s/.test(line) || /^(---+|___+|\*\*\*+)$/.test(line.trim());
}

function splitBlocks(src) {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let buf = [];
  let fence = false;
  const flush = () => {
    if (buf.length) {
      out.push(buf.join("\n"));
      buf = [];
    }
  };
  for (const line of lines) {
    if (line.startsWith("```")) {
      if (fence) {
        buf.push(line);
        flush();
        fence = false;
      } else {
        flush();
        fence = true;
        buf.push(line);
      }
      continue;
    }
    if (fence) {
      buf.push(line);
      continue;
    }
    if (/^\s*$/.test(line)) {
      flush();
      continue;
    }
    const isTable = /^\s*\|/.test(line);
    const prevTable = buf.length > 0 && /^\s*\|/.test(buf[0]);
    if (buf.length && isTable !== prevTable) flush();
    if (buf.length && listKind(line) !== listKind(buf[0])) flush();
    if (buf.length && (isStandalone(line) || isStandalone(buf[0]) ||
        /^>/.test(line) !== /^>/.test(buf[0]))) flush();
    buf.push(line);
  }
  flush();
  return out;
}

function renderBlock(block) {
  if (/^\s*\|/.test(block)) return renderTable(block);
  if (/^```/.test(block)) {
    const lines = block.split("\n");
    const body = lines.slice(1, lines[lines.length - 1]?.startsWith("```") ? -1 : undefined).join("\n");
    return `<pre class="md-pre"><code>${escapeHtml(body)}</code></pre>`;
  }
  if (/^(---+|___+|\*\*\*+)$/.test(block.trim())) return "<hr />";
  const heading = block.match(/^(#{1,6})\s+(.*)$/);
  if (heading && !block.includes("\n")) {
    const level = Math.min(heading[1].length, 4);
    return `<h${level}>${inline(heading[2] ?? "")}</h${level}>`;
  }
  if (/^>\s?/.test(block)) {
    const text = block
      .split("\n")
      .map((l) => l.replace(/^>\s?/, ""))
      .join("\n");
    return `<blockquote>${inline(text)}</blockquote>`;
  }
  if (/^\s*[-*+]\s+/.test(block)) {
    const items = block.split("\n").filter((l) => /^\s*[-*+]\s+/.test(l));
    return `<ul>${items.map((item) => `<li>${inline(item.replace(/^\s*[-*+]\s+/, ""))}</li>`).join("")}</ul>`;
  }
  if (/^\s*\d+\.\s+/.test(block)) {
    const items = block.split("\n").filter((l) => /^\s*\d+\.\s+/.test(l));
    return `<ol>${items.map((item) => `<li>${inline(item.replace(/^\s*\d+\.\s+/, ""))}</li>`).join("")}</ol>`;
  }
  return `<p>${inline(block)}</p>`;
}

export function renderMarkdown(md) {
  const text = String(md || "").trim();
  if (!text) return "<p class='muted'>No page body.</p>";
  return splitBlocks(text).map(renderBlock).join("");
}

export { escapeHtml };
