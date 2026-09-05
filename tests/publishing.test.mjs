import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from '../scripts/build.mjs';

test('publishing excludes drafts, escapes text, and fails without replacing last good output', async () => {
  const temp = await mkdtemp(path.join(tmpdir(),'repo-shelf-publish-'));
  try {
    const contentDir=path.join(temp,'content'), outDir=path.join(temp,'output'), reportDir=path.join(temp,'report');
    await mkdir(contentDir);
    const seed=JSON.parse(await readFile(new URL('../content/articles/ripgrep.json',import.meta.url),'utf8'));
    seed.title='A & B "quoted"';
    const draft={...seed,slug:'private-draft',repository:'example/private-draft',status:'draft',title:'DRAFT_SENTINEL',sources:[{label:'Repository',url:'https://github.com/example/private-draft'}]};
    await writeFile(path.join(contentDir,'ripgrep.json'),JSON.stringify(seed));
    await writeFile(path.join(contentDir,'private-draft.json'),JSON.stringify(draft));
    const result=await build({contentDir,outDir,reportDir});
    assert.equal(result.generatedArticles,1);
    const before=await readFile(path.join(outDir,'index.html'),'utf8');
    assert(before.includes('A &amp; B &quot;quoted&quot;'));
    assert(!before.includes('DRAFT_SENTINEL'));
    assert(!(await readFile(path.join(outDir,'catalog.json'),'utf8')).includes('private-draft'));
    await assert.rejects(access(path.join(outDir,'articles/private-draft')));
    await writeFile(path.join(contentDir,'ripgrep.json'),'{ broken json');
    await assert.rejects(build({contentDir,outDir,reportDir}),/Invalid JSON/);
    assert.equal(await readFile(path.join(outDir,'index.html'),'utf8'),before);
  } finally { await rm(temp,{recursive:true,force:true}); }
});
