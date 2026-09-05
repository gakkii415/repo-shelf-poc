import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isValidDate, loadContent, validateArticles } from '../scripts/content.mjs';

function article(overrides = {}) {
  return {
    schemaVersion: 1,
    slug: 'useful-tool',
    title: '開発に役立つツール',
    summary: '公式ドキュメントを確認して、導入前に知りたいポイントを紹介します。',
    repository: 'example/useful-tool',
    category: 'developer-tools',
    tags: ['CLI', '開発支援'],
    publishedAt: '2026-09-01',
    verifiedAt: '2026-09-05',
    status: 'published',
    sections: [{ heading: 'できること', paragraphs: ['コマンドラインで繰り返し作業を支援します。'], bullets: ['設定ファイルで動作を管理できます。'] }],
    sources: [{ label: 'GitHub', url: 'https://github.com/example/useful-tool' }],
    ...overrides,
  };
}
const record = data => ({ filename: `${data.slug}.json`, data });
const codes = result => result.errors.map(error => error.code);

test('valid Japanese text is preserved; only published articles contribute to site metrics', () => {
  const published = article();
  const draft = article({ slug: 'draft-tool', repository: 'example/draft-tool', status: 'draft', category: 'ai', tags: ['draft-only'], sources: [{ label: 'GitHub', url: 'https://github.com/example/draft-tool' }] });
  const result = validateArticles([record(published), record(draft)]);
  assert.equal(result.valid, true);
  assert.deepEqual(result.counts, { total: 2, valid: 2, published: 1, draft: 1, invalid: 0 });
  assert.equal(result.articles[0].title, published.title);
  assert.deepEqual(result.publishedArticles, [published]);
  assert.equal(result.metrics.repositories, 1);
  assert.equal(result.metrics.byCategory.ai, 0);
  assert.equal(result.metrics.tags, 2);
  assert.equal(result.metrics.latestVerifiedAt, '2026-09-05');
});

test('case-insensitive repository duplicates across published and draft articles invalidate both', () => {
  const draft = article({ slug: 'another-tool', repository: 'EXAMPLE/Useful-Tool', status: 'draft' });
  const result = validateArticles([record(article()), record(draft)]);
  assert.equal(result.valid, false);
  assert.equal(result.counts.invalid, 2);
  assert.equal(result.publishedArticles.length, 0);
  assert.equal(result.errors.filter(error => error.path === '$.repository' && error.code === 'duplicate').length, 2);
});

test('slug duplicates are detected even when an uppercase draft also violates the slug format', () => {
  const duplicate = article({ slug: 'USEFUL-TOOL', repository: 'example/second-tool', status: 'draft', sources: [{ label: 'GitHub', url: 'https://github.com/example/second-tool' }] });
  const result = validateArticles([record(article()), record(duplicate)]);
  assert.equal(result.valid, false);
  assert.equal(result.counts.invalid, 2);
  assert(result.errors.some(error => error.code === 'duplicate' && error.path === '$.slug'));
});

test('strict schema reports unknown top-level and nested fields with exact filename and path', () => {
  const data = article({ unexpected: true });
  data.sections[0].html = '<p>ignored?</p>';
  const result = validateArticles([record(data)]);
  assert.equal(result.valid, false);
  assert(result.errors.some(error => error.filename === 'useful-tool.json' && error.path === '$.unexpected' && error.code === 'unknown_field'));
  assert(result.errors.some(error => error.path === '$.sections[0].html' && error.code === 'unknown_field'));
});

test('missing fields, wrong types, empty arrays, and unsupported versions fail without throwing', () => {
  const malformed = article({ schemaVersion: 2, sections: null, tags: [], sources: [null], title: 5 });
  delete malformed.summary;
  const result = validateArticles([record(malformed), { filename: 'null.json', data: null }]);
  assert.equal(result.valid, false);
  assert(codes(result).includes('version'));
  assert(codes(result).includes('required'));
  assert(codes(result).includes('type'));
  assert(codes(result).includes('length'));
  assert.equal(result.counts.invalid, 2);
  assert.equal(validateArticles(null).valid, false);
});

test('date validation rejects impossible calendar dates and honors Gregorian leap years', () => {
  for (const value of ['2026-02-29', '2024-02-30', '1900-02-29', '2026-13-01', '0000-01-01', '2026-9-01', '2026-01-01T00:00:00Z']) assert.equal(isValidDate(value), false, value);
  for (const value of ['2024-02-29', '2000-02-29', '2026-09-05']) assert.equal(isValidDate(value), true, value);
  assert(codes(validateArticles([record(article({ verifiedAt: '2026-02-29' }))])).includes('date'));
});

test('script tags, event attributes, and partial HTML are rejected as plain-text violations', () => {
  for (const text of ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '<svg/onload=alert(1)>', '<script']) {
    const data = article();
    data.sections[0].paragraphs = [text];
    const result = validateArticles([record(data)]);
    assert.equal(result.valid, false, text);
    assert(result.errors.some(error => error.path === '$.sections[0].paragraphs[0]' && error.code === 'plain_text'));
  }
});

test('Markdown is kept as literal text and never rendered by the pipeline', () => {
  const data = article({ summary: '**文字列** [リンク](https://example.com)' });
  const result = validateArticles([record(data)]);
  assert.equal(result.valid, true);
  assert.equal(result.publishedArticles[0].summary, data.summary);
});

test('unsafe source URLs and unsafe repository identifiers are rejected', () => {
  for (const url of ['javascript:alert(1)', 'http://example.com', 'https://user:password@example.com', 'https://127.0.0.1', 'https://2130706433', 'https://[::1]', 'https://localhost', 'https://service.internal', 'https://example.com:444', 'https://example.com\\@evil.com']) {
    const data = article();
    data.sources.push({ label: 'More information', url });
    assert(codes(validateArticles([record(data)])).includes('url'), url);
  }
  for (const repository of ['../tool', 'owner/..', 'owner/tool/extra', 'owner/tool?x=1', 'owner/tool#x', 'owner/tool%2Fextra', '-owner/tool']) {
    assert(codes(validateArticles([record(article({ repository }))])).includes('repository'), repository);
  }
});

test('a primary GitHub repository source is required, including for drafts', () => {
  const result = validateArticles([record(article({ status: 'draft', sources: [{ label: 'Docs', url: 'https://example.com/docs' }] }))]);
  assert.equal(result.valid, false);
  assert(codes(result).includes('primary_source'));
});

test('filename must be a safe basename matching the slug', () => {
  for (const filename of ['../useful-tool.json', 'wrong-name.json', '/useful-tool.json']) {
    const result = validateArticles([{ filename, data: article() }]);
    assert.equal(result.valid, false);
    assert(codes(result).includes('filename_mismatch'));
  }
});

test('loader reports malformed JSON and symlinks rather than silently skipping files', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'repo-shelf-content-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, 'useful-tool.json'), JSON.stringify(article()));
  await writeFile(path.join(directory, 'malformed.json'), '{');
  await writeFile(path.join(directory, 'README.md'), 'This regular non-JSON file is ignored.');
  await symlink(path.join(directory, 'useful-tool.json'), path.join(directory, 'link.json'));
  const result = await loadContent(directory);
  assert.equal(result.valid, false);
  assert.deepEqual(result.counts, { total: 3, valid: 1, published: 1, draft: 0, invalid: 2 });
  assert(result.errors.some(error => error.filename === 'malformed.json' && error.code === 'json'));
  assert(result.errors.some(error => error.filename === 'link.json' && error.code === 'file_type'));
});

test('loader rejects a symlink as its content root and reports absent directories', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'repo-shelf-content-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await symlink(directory, path.join(directory, 'root-link'));
  assert.equal((await loadContent(path.join(directory, 'root-link'))).valid, false);
  assert.equal((await loadContent(path.join(directory, 'absent'))).valid, false);
});

test('CLI provides machine-readable counts and a nonzero status on invalid content', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'repo-shelf-cli-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cli = fileURLToPath(new URL('../scripts/validate-content.mjs', import.meta.url));
  await writeFile(path.join(directory, 'useful-tool.json'), JSON.stringify(article()));
  const good = spawnSync(process.execPath, [cli, directory, '--json'], { encoding: 'utf8' });
  assert.equal(good.status, 0, good.stderr);
  assert.equal(JSON.parse(good.stdout).counts.published, 1);
  await writeFile(path.join(directory, 'bad.json'), '{');
  const bad = spawnSync(process.execPath, [cli, directory, '--json'], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.equal(JSON.parse(bad.stdout).errors[0].filename, 'bad.json');
});
