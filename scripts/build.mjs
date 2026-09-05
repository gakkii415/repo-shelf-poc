import { mkdir, readFile, writeFile, rm, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadContent } from './content.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const categories = {ai:'AI・機械学習',frontend:'Web制作',backend:'バックエンド','developer-tools':'開発ツール',data:'データ',automation:'自動化'};
export const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const e = escapeHtml;
const repoUrl = article => `https://github.com/${article.repository}`;
const icon = '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg>';

function shell({title,description,content,prefix='./',script,config}) {
  return `<!doctype html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="${e(description)}"><meta name="theme-color" content="#14233c"><title>${e(title)} | ${e(config.name)}</title><link rel="stylesheet" href="${prefix}assets/styles.css"><link rel="icon" href="${prefix}favicon.svg" type="image/svg+xml">${script ? `<script defer src="${prefix}assets/${script}"></script>` : ''}</head><body><a class="skip" href="#main">本文へ</a><header class="topbar"><div class="wrap"><a class="brand" href="${prefix}"><span class="brand-mark" aria-hidden="true">/r</span>${e(config.name)}</a><span class="header-note">GitHubリポジトリガイド</span></div></header>${content}<footer class="footer"><div class="wrap"><span>${e(config.name)} <span aria-label="バージョン">${e(config.version)}</span></span><span>AI編集 · 出典は各記事に記載</span></div></footer></body></html>`;
}
function row(article) {
  const search = [article.title,article.summary,article.repository,...article.tags,categories[article.category],...article.sections.flatMap(s=>[s.heading,...s.paragraphs,...(s.bullets??[])])].join(' ').toLocaleLowerCase('ja');
  return `<a class="repo-row" href="./articles/${e(article.slug)}/" data-category="${e(article.category)}" data-repository="${e(article.repository)}" data-date="${e(article.publishedAt)}" data-search="${e(search)}"><span class="repo-icon" aria-hidden="true">${e(article.repository.split('/')[1].slice(0,2).toUpperCase())}</span><div><p class="repo-path">${e(article.repository)}</p><h2>${e(article.title)}</h2><p class="repo-summary">${e(article.summary)}</p><div class="row-meta"><span class="category-label">${e(categories[article.category])}</span>${article.tags.slice(0,2).map(t=>`<span>${e(t)}</span>`).join('')}<time datetime="${e(article.publishedAt)}">${e(article.publishedAt.replaceAll('-','.'))}</time></div></div><span class="row-arrow" aria-hidden="true">↗</span></a>`;
}
function catalog(articles,config) {
  return shell({title:'リポジトリを探す',description:config.description,script:'catalog.js',config,content:`<main id="main" class="wrap catalog"><p class="eyebrow">THE REPOSITORY INDEX</p><h1>リポジトリを探す</h1><p class="lede">${e(config.description)}</p><div id="controls" hidden><form id="search-form" role="search"><label class="visually-hidden" for="search">リポジトリを検索</label><div class="search-wrap">${icon}<input type="search" id="search" placeholder="名前・用途・技術で検索" autocomplete="off"></div></form><div class="filters" aria-label="カテゴリ"><button type="button" class="filter" data-category="all" aria-pressed="true">すべて</button>${Object.entries(categories).map(([id,label])=>`<button type="button" class="filter" data-category="${id}" aria-pressed="false">${label}</button>`).join('')}</div></div><noscript><p class="noscript">すべての記事を表示しています。検索にはJavaScriptを有効にしてください。</p></noscript><div class="results-toolbar"><p id="result-count" role="status" aria-live="polite">${articles.length}件のリポジトリ</p><div><label class="visually-hidden" for="sort">並べ替え</label><select id="sort"><option value="newest">新着順</option><option value="name">リポジトリ名順</option></select></div></div><div class="repo-list" id="repo-list">${articles.map(row).join('')}</div><div class="empty" id="empty" ${articles.length?'hidden':''}><h2>見つかりませんでした</h2><p>別のキーワードやカテゴリで探してみてください。</p><button class="clear-button" id="clear" type="button">検索条件をクリア</button></div><nav id="pagination" class="pagination" aria-label="ページ送り" hidden><button id="previous" type="button">前へ</button><span id="page-label"></span><button id="next" type="button">次へ</button></nav></main>`});
}
function articlePage(article,config) {
  return shell({title:article.title,description:article.summary,prefix:'../../',script:'article.js',config,content:`<main class="wrap article-shell" id="main"><a class="back" id="back" href="../../">← 一覧に戻る</a><div class="article-grid"><article><header class="article-head"><span class="category-label">${e(categories[article.category])}</span><h1>${e(article.title)}</h1><p class="repo-path">${e(article.repository)}</p><p class="article-summary">${e(article.summary)}</p><a class="github-link" href="${e(repoUrl(article))}" target="_blank" rel="noopener noreferrer">GitHubで見る <span aria-hidden="true">↗</span><span class="visually-hidden">（新しいタブ）</span></a></header><div class="article-body">${article.sections.map(section=>`<section><h2>${e(section.heading)}</h2>${section.paragraphs.map(p=>`<p>${e(p)}</p>`).join('')}${section.bullets?.length?`<ul>${section.bullets.map(b=>`<li>${e(b)}</li>`).join('')}</ul>`:''}</section>`).join('')}</div></article><aside class="article-aside" aria-label="記事の情報"><h2>この記事について</h2><dl><dt>確認日</dt><dd><time datetime="${e(article.verifiedAt)}">${e(article.verifiedAt.replaceAll('-','.'))}</time></dd><dt>タグ</dt><dd class="tags">${article.tags.map(t=>`<span class="tag">${e(t)}</span>`).join('')}</dd></dl><h2>出典</h2><ul class="source-list">${article.sources.map(s=>`<li><a href="${e(s.url)}" rel="noopener noreferrer" target="_blank">${e(s.label)} ↗<span class="visually-hidden">（新しいタブ）</span></a></li>`).join('')}</ul><p class="source-note">AIが編集した紹介記事です。導入時には公式の最新情報をご確認ください。</p></aside></div></main>`});
}
export async function build({contentDir=path.join(root,'content/articles'),outDir=path.join(root,'dist'),reportDir=path.join(root,'reports')}={}) {
  const start = performance.now();
  const result = await loadContent(contentDir);
  if (!result.valid) { const error = new Error(result.errors.map(x=>`${x.filename}:${x.path} ${x.message}`).join('\n')); error.validation = result; throw error; }
  const config = JSON.parse(await readFile(path.join(root,'site.config.json'),'utf8'));
  const basePath = process.env.BASE_PATH || '/';
  if (!/^\/(?:[a-zA-Z0-9._-]+\/)*$/.test(basePath)) throw Error('BASE_PATH must be an absolute directory path ending in /');
  // Validation precedes deleting the last good output. Explicit output dirs are caller-owned.
  await rm(outDir,{recursive:true,force:true});
  await mkdir(path.join(outDir,'assets'),{recursive:true});
  for (const file of ['styles.css','catalog.js','article.js']) await copyFile(path.join(root,'src',file),path.join(outDir,'assets',file));
  await writeFile(path.join(outDir,'favicon.svg'),'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#14233c"/><text x="10" y="45" fill="white" font-size="40" font-family="monospace">/r</text></svg>');
  await writeFile(path.join(outDir,'index.html'),catalog(result.publishedArticles,config));
  for (const article of result.publishedArticles) { const dir = path.join(outDir,'articles',article.slug); await mkdir(dir,{recursive:true}); await writeFile(path.join(dir,'index.html'),articlePage(article,config)); }
  await writeFile(path.join(outDir,'404.html'),shell({title:'ページが見つかりません',description:'お探しのページはありません。',prefix:basePath,config,content:`<main id="main" class="wrap catalog"><h1>ページが見つかりません</h1><p>URLを確認するか、一覧から記事を探してください。</p><a href="${e(basePath)}">一覧を開く</a></main>`}));
  const manifest = {schemaVersion:1,articles:result.publishedArticles.map(a=>({slug:a.slug,repository:a.repository,title:a.title,category:a.category,path:`articles/${a.slug}/`}))};
  await writeFile(path.join(outDir,'catalog.json'),JSON.stringify(manifest,null,2)+'\n');
  await writeFile(path.join(outDir,'.nojekyll'),'');
  const report = {counts:result.counts,metrics:result.metrics,generatedArticles:result.publishedArticles.length,buildMs:Math.round(performance.now()-start)};
  await mkdir(reportDir,{recursive:true}); await writeFile(path.join(reportDir,'build.json'),JSON.stringify(report,null,2)+'\n');
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await build(),null,2)); } catch(error) { console.error(error.message); process.exitCode = 1; }
}
