// lib/extract.js
// Extract text and metadata from PDF / EPUB files.

const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const AdmZip = require('adm-zip');

// ---------- PDF ----------
async function extractPdf(filePath) {
  const data = await pdfParse(fs.readFileSync(filePath));
  const info = data.info || {};
  const numPages = data.numpages || 0;

  // pdf-parse joins page text with a form feed character.
  const pages = (data.text || '')
    .split('\f')
    .map(t => cleanWhitespace(t))
    .filter(t => t.length > 0);

  return {
    kind: 'pdf',
    pageCount: numPages || pages.length,
    pages,
    metadata: {
      title: (info.Title || '').trim(),
      author: (info.Author || '').trim(),
      year: parseYear(info.CreationDate || info.ModDate || ''),
    },
  };
}

// ---------- EPUB ----------
function extractEpub(filePath) {
  const zip = new AdmZip(filePath);
  const containerEntry = zip.getEntry('META-INF/container.xml');
  if (!containerEntry) throw new Error('Geçersiz EPUB: container.xml bulunamadı.');
  const containerXml = containerEntry.getData().toString('utf8');

  const opfPath = matchAttr(containerXml, 'rootfile', 'full-path');
  if (!opfPath) throw new Error('Geçersiz EPUB: OPF dosyası bulunamadı.');

  const opfEntry = zip.getEntry(opfPath);
  if (!opfEntry) throw new Error('Geçersiz EPUB: OPF okunamadı.');
  const opfXml = opfEntry.getData().toString('utf8');

  const opfDir = path.posix.dirname(opfPath);
  const metadata = readOpfMetadata(opfXml);
  const spine = readOpfSpine(opfXml);

  const pageTexts = [];
  for (const idRef of spine) {
    const href = resolveOpfHref(opfXml, idRef);
    if (!href) continue;
    const entryPath = path.posix.join(opfDir, href);
    const entry = zip.getEntry(entryPath);
    if (!entry) continue;
    const html = entry.getData().toString('utf8');
    const text = htmlToText(html);
    if (text) pageTexts.push(text);
  }

  return {
    kind: 'epub',
    pageCount: pageTexts.length,
    pages: pageTexts,
    metadata,
  };
}

// ---------- Auto-detect (used as fallback) ----------
function detectFromPages(pages) {
  const sample = pages.slice(0, Math.min(3, pages.length)).join('\n');
  return {
    title: guessTitle(pages[0] || ''),
    author: guessAuthor(pages[0] || '', pages[1] || ''),
    year: guessYear(sample),
  };
}

// ---------- Helpers ----------
function cleanWhitespace(s) {
  return (s || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function parseYear(s) {
  if (!s) return null;
  const m = String(s).match(/(1[5-9]\d{2}|20\d{2})/);
  return m ? parseInt(m[1], 10) : null;
}

function matchAttr(xml, tag, attr) {
  const re = new RegExp(`<${tag}\\b[^>]*\\b${attr}="([^"]+)"`, 'i');
  const m = xml.match(re);
  return m ? m[1] : null;
}

function matchText(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const m = xml.match(re);
  if (!m) return '';
  return m[1].replace(/<[^>]+>/g, '').trim();
}

function readOpfMetadata(xml) {
  return {
    title: matchText(xml, 'dc:title'),
    author: matchText(xml, 'dc:creator'),
    year: parseYear(matchText(xml, 'dc:date')),
  };
}

function readOpfSpine(xml) {
  const spineBlock = (xml.match(/<spine\b[\s\S]*?<\/spine>/i) || [''])[0];
  const ids = [];
  const re = /<itemref\b[^>]*\bidref="([^"]+)"/gi;
  let m;
  while ((m = re.exec(spineBlock)) !== null) ids.push(m[1]);
  return ids;
}

function resolveOpfHref(xml, idRef) {
  const manifest = (xml.match(/<manifest\b[\s\S]*?<\/manifest>/i) || [''])[0];
  const re = new RegExp(`<item\\b[^>]*\\bid="${idRef}"[^>]*\\bhref="([^"]+)"`, 'i');
  const m = manifest.match(re);
  if (m) return m[1];
  // href may appear before id; try the other order
  const re2 = new RegExp(`<item\\b[^>]*\\bhref="([^"]+)"[^>]*\\bid="${idRef}"`, 'i');
  const m2 = manifest.match(re2);
  return m2 ? m2[1] : null;
}

function htmlToText(html) {
  if (!html) return '';
  return cleanWhitespace(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h[1-6]|li|blockquote)>/gi, '\n\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
  );
}

function guessTitle(firstPage) {
  if (!firstPage) return '';
  const lines = firstPage.split('\n').map(l => l.trim()).filter(Boolean);
  // Skip very short/garbage lines, prefer a line that looks like a title.
  for (const line of lines.slice(0, 8)) {
    if (line.length < 2) continue;
    if (/^[\d\W_]+$/.test(line)) continue;
    if (/^(by|yazan|çeviren|yayınevi|publisher|copyright|all rights)/i.test(line)) continue;
    if (line.length > 120) continue;
    return line;
  }
  return lines[0] || '';
}

function guessAuthor(firstPage, secondPage) {
  const sources = [firstPage, secondPage];
  for (const src of sources) {
    if (!src) continue;
    const lines = src.split('\n').map(l => l.trim()).filter(Boolean);
    for (let i = 1; i < Math.min(8, lines.length); i++) {
      const line = lines[i];
      if (/^(by|yazar|yazan|author|çeviren|translator)\b[:\s]/i.test(line)) {
        return line.replace(/^(by|yazar|yazan|author|çeviren|translator)\b[:\s]*/i, '').trim();
      }
    }
  }
  return '';
}

function guessYear(sample) {
  const m = sample.match(/(1[5-9]\d{2}|20\d{2})/);
  return m ? parseInt(m[1], 10) : null;
}

// ---------- Unified entry ----------
async function extractBook(filePath, declaredKind) {
  const ext = (path.extname(filePath) || '').toLowerCase().replace('.', '');
  const kind = declaredKind || ext;
  let result;
  if (kind === 'pdf') {
    result = await extractPdf(filePath);
  } else if (kind === 'epub') {
    result = extractEpub(filePath);
  } else {
    throw new Error('Desteklenmeyen dosya türü. PDF veya EPUB yükleyin.');
  }

  // Fill in any missing metadata from page text heuristics.
  const detected = detectFromPages(result.pages);
  result.metadata = {
    title: result.metadata.title || detected.title || '',
    author: result.metadata.author || detected.author || '',
    year: result.metadata.year || detected.year || null,
  };
  return result;
}

module.exports = { extractBook, extractPdf, extractEpub };
