import { mkdtemp, mkdir, readFile, writeFile, readdir, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from './build.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(path.join(tmpdir(),'repo-shelf-benchmark-'));
const results = [];
async function bytes(dir) { let size=0; for(const file of await readdir(dir,{withFileTypes:true})){ const name=path.join(dir,file.name); size += file.isDirectory()?await bytes(name):(await stat(name)).size; } return size; }
try {
  const seed = JSON.parse(await readFile(path.join(root,'content/articles/ripgrep.json'),'utf8'));
  for (const count of [30,100]) {
    const contentDir = path.join(temporary,`content-${count}`);
    const outDir = path.join(temporary,`out-${count}`);
    await mkdir(contentDir);
    for(let i=0;i<count;i++) {
      const slug=`fixture-${String(i).padStart(3,'0')}`;
      const data = {...seed,slug,repository:`benchmark/${slug}`,title:`検証専用 ${i+1}: ${seed.title}`,sources:[{label:'Fixture URL — not an actual recommendation',url:`https://github.com/benchmark/${slug}`}]};
      await writeFile(path.join(contentDir,`${slug}.json`),JSON.stringify(data));
    }
    const report = await build({contentDir,outDir,reportDir:path.join(temporary,'reports')});
    const manifest = JSON.parse(await readFile(path.join(outDir,'catalog.json'),'utf8'));
    if(manifest.articles.length!==count || (await readdir(path.join(outDir,'articles'))).length!==count) throw Error('Generated article count does not match input count');
    results.push({inputArticles:count,generatedArticles:report.generatedArticles,buildMs:report.buildMs,totalBytes:await bytes(outDir)});
  }
  await mkdir(path.join(root,'reports'),{recursive:true});
  await writeFile(path.join(root,'reports/benchmark.json'),JSON.stringify({note:'Synthetic fixtures test publishing capacity, not writing quality or live GitHub transport.',results},null,2)+'\n');
  console.log(JSON.stringify(results,null,2));
} finally { await rm(temporary,{recursive:true,force:true}); }
