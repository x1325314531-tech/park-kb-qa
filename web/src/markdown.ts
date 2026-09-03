/**
 * 极简 Markdown 渲染器（零依赖、XSS 安全）：
 * 先整体转义 HTML，再按行解析块级语法（标题/引用/分隔线/列表/代码块），
 * 块内做行内解析（**加粗**、*斜体*、`行内代码`）。
 * 支持：H1-H4、加粗、斜体、行内代码、代码块、无序/有序列表、引用、分隔线、段落。
 */

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inline(s: string): string {
  let t = s;
  // 先抽出行内代码，避免内部符号被后续规则破坏
  const codes: string[] = [];
  t = t.replace(/`([^`]+)`/g, (_m, c) => {
    codes.push(c);
    return `\u0000${codes.length - 1}\u0000`;
  });
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  // 链接保留文字、去掉跳转（避免回答里出现可点击外链风险）
  t = t.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  t = t.replace(/\u0000(\d+)\u0000/g, (_m, i) => `<code>${codes[Number(i)]}</code>`);
  return t;
}

export function renderMarkdown(src: string): string {
  const lines = escapeHtml(src || '').split('\n');
  const out: string[] = [];
  let inCode = false;
  let codeBuf: string[] = [];
  let listType: 'ul' | 'ol' | null = null;
  let listBuf: string[] = [];

  const flushList = () => {
    if (listType && listBuf.length) {
      out.push(`<${listType}>${listBuf.map((x) => `<li>${inline(x)}</li>`).join('')}</${listType}>`);
    }
    listType = null;
    listBuf = [];
  };

  for (const raw of lines) {
    const line = raw;
    const t = line.trim();

    if (t.startsWith('```')) {
      if (inCode) {
        out.push(`<pre><code>${codeBuf.join('\n')}</code></pre>`);
        codeBuf = [];
        inCode = false;
      } else {
        flushList();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
      continue;
    }

    const h = /^(#{1,4})\s+(.*)$/.exec(t);
    if (h) {
      flushList();
      const level = h[1].length;
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
      continue;
    }

    if (t.startsWith('>')) {
      flushList();
      out.push(`<blockquote>${inline(t.replace(/^>\s?/, ''))}</blockquote>`);
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) {
      flushList();
      out.push('<hr/>');
      continue;
    }

    const ul = /^[-*+]\s+(.*)$/.exec(t);
    if (ul) {
      if (listType !== 'ul') {
        flushList();
        listType = 'ul';
      }
      listBuf.push(ul[1]);
      continue;
    }

    const ol = /^\d+[.、)]\s+(.*)$/.exec(t);
    if (ol) {
      if (listType !== 'ol') {
        flushList();
        listType = 'ol';
      }
      listBuf.push(ol[1]);
      continue;
    }

    if (!t) {
      flushList();
      continue;
    }

    flushList();
    out.push(`<p>${inline(t)}</p>`);
  }

  flushList();
  if (inCode && codeBuf.length) out.push(`<pre><code>${codeBuf.join('\n')}</code></pre>`);
  return out.join('\n');
}
