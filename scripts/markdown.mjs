// A small Markdown-to-HTML converter for rules.md: headings, paragraphs, nested ordered and bulleted
// lists, tables, bold, italics, inline code and links. HTML comments are dropped. Nothing else is needed.

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const slug = (text) => text.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function inline(text) {
  const codes = [];
  let s = esc(text).replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, href) => `<a href="${href}">${t}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
}

const LIST = /^(\d+\.|-) (.*)$/;
const indentOf = (line) => line.match(/^ */)[0].length;

function blocks(lines) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (/^<!--.*-->$/.test(line.trim())) { i++; continue; }
    const h = line.match(/^(#{1,4}) (.*)$/);
    if (h) { const n = h[1].length; out.push(`<h${n} id="${slug(h[2])}">${inline(h[2])}</h${n}>`); i++; continue; }
    if (line.startsWith('|')) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith('|')) rows.push(lines[i++]);
      const cells = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const [head, , ...body] = rows;
      out.push(`<div class="tablewrap"><table><thead><tr>${cells(head).map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead>`
        + `<tbody>${body.map((r) => `<tr>${cells(r).map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    const li = line.match(LIST);
    if (li) {
      const ordered = li[1] !== '-';
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(LIST);
        if (!m || (m[1] !== '-') === !ordered) break;
        const width = m[1].length + 1;
        const body = [m[2]];
        i++;
        while (i < lines.length && (!lines[i].trim() || indentOf(lines[i]) >= width)) {
          if (!lines[i].trim() && (i + 1 >= lines.length || indentOf(lines[i + 1]) < width)) break;
          body.push(lines[i].slice(width));
          i++;
        }
        const inner = blocks(body);
        items.push(inner.length === 1 && inner[0].startsWith('<p>') ? inner[0].slice(3, -4) : inner.join(''));
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map((x) => `<li>${x}</li>`).join('')}</${tag}>`);
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4} |\||<!--)/.test(lines[i]) && !LIST.test(lines[i])) para.push(lines[i++].trim());
    // A paragraph followed directly by its first sub-item (a list) is still a paragraph.
    out.push(`<p>${inline(para.join(' '))}</p>`);
  }
  return out;
}

/** Convert Markdown text to HTML. */
export const markdownToHtml = (md) => blocks(md.replace(/\r/g, '').split('\n')).join('\n');
