import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const runner = path.join(path.dirname(require.resolve('npm-run-all2/package.json')), 'bin/npm-run-all/index.js');

test('development runner starts both tasks concurrently and propagates failure', { timeout: 30000 }, async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'runner-fixture-'));
  try {
    await writeFile(path.join(folder, 'package.json'), JSON.stringify({ private: true, scripts: {
      'fixture:one': 'node fixture.mjs one',
      'fixture:two': 'node fixture.mjs two',
      'fixture:fail': 'node -e "process.exit(7)"',
    } }));
    await writeFile(path.join(folder, 'fixture.mjs'), `
      import { writeFile, access } from 'node:fs/promises';
      const own = process.argv[2], peer = own === 'one' ? 'two' : 'one';
      await writeFile(own + '.started', 'fixture');
      const deadline = Date.now() + 5000;
      for (;;) {
        try { await access(peer + '.started'); break; } catch {}
        if (Date.now() > deadline) process.exit(9);
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    `);
    const options = { cwd: folder, encoding: 'utf8', timeout: 15000, windowsHide: true };
    const success = spawnSync(process.execPath, [runner, '--parallel', 'fixture:one', 'fixture:two'], options);
    assert.ifError(success.error);
    assert.equal(success.status, 0, success.stdout + success.stderr);
    const failure = spawnSync(process.execPath, [runner, 'fixture:fail'], options);
    assert.ifError(failure.error);
    assert.notEqual(failure.status, 0);
    assert.match(failure.stderr, /exited with 7/);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
