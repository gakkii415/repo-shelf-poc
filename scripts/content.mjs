import { constants } from 'node:fs';
import { open, readdir } from 'node:fs/promises';
import { isIP } from 'node:net';
import path from 'node:path';

export const CATEGORIES = Object.freeze([
  'ai', 'frontend', 'backend', 'developer-tools', 'data', 'automation',
]);

const ARTICLE_FIELDS = [
  'schemaVersion', 'slug', 'title', 'summary', 'repository', 'category',
  'tags', 'publishedAt', 'verifiedAt', 'status', 'sections', 'sources',
];
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_FILE_BYTES = 256 * 1024;
const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));

/** True only for an actual Gregorian calendar date, expressed as YYYY-MM-DD. */
export function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

function safeRepository(value) {
  if (typeof value !== 'string') return false;
  const parts = value.split('/');
  if (parts.length !== 2) return false;
  const [owner, repo] = parts;
  return /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/i.test(owner)
    && !owner.includes('--') && /^[a-z0-9._-]{1,100}$/i.test(repo)
    && repo !== '.' && repo !== '..';
}

function safeSourceUrl(value) {
  if (typeof value !== 'string' || value.length > 2048 || !/^https:\/\//i.test(value)
    || /[\s\\<>\u0000-\u001f\u007f]/u.test(value)) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || url.port
      || !host.includes('.') || host.endsWith('.') || isIP(host) || host.startsWith('[')
      || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host)
      || !host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) return null;
    return url;
  } catch {
    return null;
  }
}

function summarize(articles, errors, total) {
  const publishedArticles = articles.filter(article => article.status === 'published')
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.slug.localeCompare(b.slug));
  const byCategory = Object.fromEntries(CATEGORIES.map(category => [category, 0]));
  const tagCounts = new Map();
  for (const article of publishedArticles) {
    byCategory[article.category] += 1;
    for (const tag of article.tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  }
  return {
    valid: errors.length === 0,
    articles,
    publishedArticles,
    errors,
    counts: {
      total,
      valid: articles.length,
      published: publishedArticles.length,
      draft: articles.length - publishedArticles.length,
      invalid: total - articles.length,
    },
    metrics: {
      repositories: new Set(publishedArticles.map(article => article.repository.toLowerCase())).size,
      categories: Object.values(byCategory).filter(count => count > 0).length,
      tags: tagCounts.size,
      latestPublishedAt: publishedArticles[0]?.publishedAt ?? null,
      latestVerifiedAt: publishedArticles.map(article => article.verifiedAt).sort().at(-1) ?? null,
      byCategory,
      byTag: Object.fromEntries([...tagCounts.entries()].sort(([a], [b]) => a.localeCompare(b))),
    },
  };
}

/**
 * Validate records without mutating them. A record is { filename: 'slug.json', data: object }.
 * Never render any field as HTML or Markdown. Invalid records are excluded from articles;
 * callers MUST check result.valid and fail their build before using partial output.
 */
export function validateArticles(records) {
  const errors = [];
  const validRecords = [];
  const badIndexes = new Set();
  const seenSlugs = new Map();
  const seenRepos = new Map();
  if (!Array.isArray(records)) {
    return summarize([], [{ filename: '<input>', path: '$', code: 'type', message: 'Expected an array of { filename, data } records.' }], 0);
  }

  records.forEach((record, index) => {
    const filename = typeof record?.filename === 'string' ? record.filename : `<record ${index}>`;
    const error = (field, code, message) => {
      badIndexes.add(index);
      errors.push({ filename, path: field, code, message });
    };
    const object = (value, field, allowed, required = allowed) => {
      if (!plainObject(value)) {
        error(field, 'type', 'Expected an object.');
        return false;
      }
      for (const key of Object.keys(value)) {
        if (!allowed.includes(key)) error(`${field}.${key}`, 'unknown_field', 'Unknown field.');
      }
      for (const key of required) {
        if (!Object.hasOwn(value, key)) error(`${field}.${key}`, 'required', 'Required field is missing.');
      }
      return true;
    };
    const string = (value, field, max, min = 1) => {
      if (typeof value !== 'string') {
        error(field, 'type', 'Expected a string.');
        return false;
      }
      if (value.length < min || value.length > max || value !== value.trim()) {
        error(field, 'length', `Must contain ${min}–${max} characters with no surrounding whitespace.`);
      }
      // Plain text only. Reject angle brackets, including partial tags, rather than sanitizing.
      if (/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
        error(field, 'plain_text', 'HTML, angle brackets, and control characters are not allowed.');
      }
      return true;
    };
    const strings = (value, field, min, max, itemMax) => {
      if (!Array.isArray(value)) {
        error(field, 'type', 'Expected an array.');
        return false;
      }
      if (value.length < min || value.length > max) error(field, 'length', `Expected ${min}–${max} items.`);
      value.forEach((item, itemIndex) => string(item, `${field}[${itemIndex}]`, itemMax));
      return true;
    };
    const duplicate = (value, seen, field) => {
      if (typeof value !== 'string') return;
      const key = value.toLowerCase();
      if (seen.has(key)) {
        const previous = seen.get(key);
        error(field, 'duplicate', `Duplicate ${field.slice(2)}; first used in ${previous.filename}.`);
        if (!badIndexes.has(previous.index)) {
          errors.push({ filename: previous.filename, path: field, code: 'duplicate', message: `Duplicate ${field.slice(2)}; also used in ${filename}.` });
        }
        badIndexes.add(previous.index);
      } else seen.set(key, { filename, index });
    };

    if (!object(record, '$record', ['filename', 'data'])) return;
    if (typeof record.filename !== 'string' || record.filename.length > 85
      || !/^[a-z0-9]+(?:-[a-z0-9]+)*\.json$/.test(record.filename)) {
      error('$record.filename', 'filename', 'Expected a lowercase kebab-case JSON basename, at most 80 characters before .json.');
    }
    const data = record.data;
    if (!object(data, '$', ARTICLE_FIELDS)) return;
    if (data.schemaVersion !== 1) error('$.schemaVersion', 'version', 'Only schemaVersion 1 is supported.');
    if (string(data.slug, '$.slug', 80) && !SLUG.test(data.slug)) error('$.slug', 'slug', 'Use lowercase letters, numbers, and single hyphens.');
    if (typeof data.slug === 'string' && record.filename !== `${data.slug}.json`) error('$.slug', 'filename_mismatch', 'Slug must match the JSON filename.');
    string(data.title, '$.title', 120);
    string(data.summary, '$.summary', 400);
    if (!safeRepository(data.repository)) error('$.repository', 'repository', 'Expected a safe GitHub owner/name repository identifier.');
    if (!CATEGORIES.includes(data.category)) error('$.category', 'enum', `Expected one of: ${CATEGORIES.join(', ')}.`);
    if (strings(data.tags, '$.tags', 1, 8, 40)) {
      const tags = data.tags.filter(tag => typeof tag === 'string').map(tag => tag.toLowerCase());
      if (new Set(tags).size !== tags.length) error('$.tags', 'duplicate', 'Tags must be unique ignoring case.');
    }
    for (const field of ['publishedAt', 'verifiedAt']) {
      if (!isValidDate(data[field])) error(`$.${field}`, 'date', 'Expected a real calendar date in YYYY-MM-DD format.');
    }
    if (!['draft', 'published'].includes(data.status)) error('$.status', 'enum', 'Expected draft or published.');
    if (!Array.isArray(data.sections)) error('$.sections', 'type', 'Expected an array.');
    else {
      if (data.sections.length < 1 || data.sections.length > 12) error('$.sections', 'length', 'Expected 1–12 sections.');
      data.sections.forEach((section, sectionIndex) => {
        const field = `$.sections[${sectionIndex}]`;
        if (!object(section, field, ['heading', 'paragraphs', 'bullets'], ['heading', 'paragraphs'])) return;
        string(section.heading, `${field}.heading`, 120);
        strings(section.paragraphs, `${field}.paragraphs`, 1, 12, 3000);
        if (Object.hasOwn(section, 'bullets')) strings(section.bullets, `${field}.bullets`, 1, 12, 600);
      });
    }
    let hasPrimarySource = false;
    if (!Array.isArray(data.sources)) error('$.sources', 'type', 'Expected an array.');
    else {
      if (data.sources.length < 1 || data.sources.length > 12) error('$.sources', 'length', 'Expected 1–12 sources.');
      data.sources.forEach((source, sourceIndex) => {
        const field = `$.sources[${sourceIndex}]`;
        if (!object(source, field, ['label', 'url'])) return;
        string(source.label, `${field}.label`, 120);
        const url = safeSourceUrl(source.url);
        if (!url) error(`${field}.url`, 'url', 'Expected a public HTTPS URL without credentials, IP host, custom port, whitespace, or backslashes.');
        else if (url.hostname.toLowerCase() === 'github.com' && typeof data.repository === 'string'
          && url.pathname.replace(/\/$/, '').toLowerCase() === `/${data.repository.toLowerCase()}`) hasPrimarySource = true;
      });
    }
    if (!hasPrimarySource) error('$.sources', 'primary_source', 'Include the repository itself as an HTTPS github.com/owner/name source.');
    duplicate(data.slug, seenSlugs, '$.slug');
    duplicate(data.repository, seenRepos, '$.repository');
    validRecords.push({ index, data });
  });
  return summarize(validRecords.filter(record => !badIndexes.has(record.index)).map(record => record.data), errors, records.length);
}

/** Read the immediate directory; validate every JSON file, reject symlinks, ignore other regular files. */
export async function loadContent(directory) {
  const records = [];
  const errors = [];
  let unreadableFiles = 0;
  let entries;
  try {
    // Opening the directory itself with O_NOFOLLOW also rejects a symlink as the requested root.
    const root = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    await root.close();
    entries = await readdir(directory, { withFileTypes: true });
  } catch (cause) {
    return summarize([], [{ filename: String(directory), path: '$', code: 'directory', message: `Cannot read content directory (${cause.code ?? 'unknown error'}).` }], 0);
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isSymbolicLink() || entry.isDirectory()) {
      unreadableFiles += 1;
      errors.push({ filename: entry.name, path: '$', code: 'file_type', message: 'Symlinks and nested directories are not allowed in the content directory.' });
      continue;
    }
    if (!/\.json$/i.test(entry.name)) continue;
    let file;
    try {
      file = await open(path.join(directory, entry.name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const stat = await file.stat();
      if (!stat.isFile()) throw Object.assign(new Error('Expected a regular file.'), { code: 'FILE_TYPE' });
      if (stat.size > MAX_FILE_BYTES) throw Object.assign(new Error('JSON file exceeds 256 KiB.'), { code: 'FILE_SIZE' });
      const text = await file.readFile('utf8');
      if (Buffer.byteLength(text, 'utf8') > MAX_FILE_BYTES) throw Object.assign(new Error('JSON file exceeds 256 KiB.'), { code: 'FILE_SIZE' });
      records.push({ filename: entry.name, data: JSON.parse(text) });
    } catch (cause) {
      unreadableFiles += 1;
      errors.push({ filename: entry.name, path: '$', code: cause instanceof SyntaxError ? 'json' : 'read', message: cause instanceof SyntaxError ? 'Invalid JSON syntax.' : `Cannot read article (${cause.code ?? 'unknown error'}).` });
    } finally {
      await file?.close();
    }
  }
  const result = validateArticles(records);
  return summarize(result.articles, [...errors, ...result.errors], records.length + unreadableFiles);
}
