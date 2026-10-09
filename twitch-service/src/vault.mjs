import {createHash, randomBytes, createCipheriv, createDecipheriv} from 'node:crypto';
import {mkdir, readFile, writeFile, rename} from 'node:fs/promises';
import {dirname} from 'node:path';

export class TokenVault {
  constructor(path, encryptionKey) {
    if (!encryptionKey || encryptionKey.length < 32) throw new Error('TOKEN_ENCRYPTION_KEY must contain at least 32 characters.');
    this.path = path;
    this.key = createHash('sha256').update(encryptionKey).digest();
    this.records = {};
    this.chain = Promise.resolve();
  }
  async load() {
    try {
      const file = JSON.parse(await readFile(this.path, 'utf8'));
      if (file.version !== 1) throw new Error('Unsupported token vault version.');
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(file.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(file.tag, 'base64'));
      this.records = JSON.parse(Buffer.concat([decipher.update(Buffer.from(file.data, 'base64')), decipher.final()]).toString('utf8'));
    } catch (error) { if (error.code !== 'ENOENT') throw new Error('Cannot decrypt the token vault. Check its encryption key.'); }
    return this;
  }
  list() { return Object.values(this.records); }
  get(code) { return this.records[code]; }
  async set(code, record) { this.records[code] = record; await this.save(); }
  async delete(code) { delete this.records[code]; await this.save(); }
  save() {
    this.chain = this.chain.catch(() => {}).then(async () => {
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, iv);
      const data = Buffer.concat([cipher.update(JSON.stringify(this.records)), cipher.final()]);
      await mkdir(dirname(this.path), {recursive: true, mode: 0o700});
      await writeFile(this.path + '.tmp', JSON.stringify({version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64')}), {mode: 0o600});
      await rename(this.path + '.tmp', this.path);
    });
    return this.chain;
  }
}
