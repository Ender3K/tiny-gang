import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {TokenVault} from '../src/vault.mjs';
test('vault encrypts tokens, restores after restart and rejects a wrong key', async () => {
  const dir = await mkdtemp(join(tmpdir(),'twitch-vault-')), path = join(dir,'tokens.json'), key = 'a'.repeat(64);
  try {
    const vault = await new TokenVault(path,key).load(); await vault.set('ROAR80',{code:'ROAR80',accessToken:'never-plaintext',refreshToken:'private-refresh'});
    const text = await readFile(path,'utf8'); assert(!text.includes('never-plaintext')); assert(!text.includes('private-refresh')); assert.equal((await stat(path)).mode & 0o777,0o600);
    const restored = await new TokenVault(path,key).load(); assert.equal(restored.get('ROAR80').accessToken,'never-plaintext');
    await assert.rejects(new TokenVault(path,'b'.repeat(64)).load(),/Cannot decrypt/);
    await restored.delete('ROAR80'); assert.deepEqual((await new TokenVault(path,key).load()).list(),[]);
  } finally {await rm(dir,{recursive:true,force:true});}
});
