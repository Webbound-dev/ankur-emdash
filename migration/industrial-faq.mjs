// Add the missing Industrial Salt FAQ to an existing local database.
// Dry run by default. --apply backs up the database before any writes.
import { DatabaseSync, backup } from 'node:sqlite';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';

const { values } = parseArgs({ options: {
  database: { type: 'string' }, apply: { type: 'boolean', default: false },
} });
if (!values.database || !existsSync(values.database)) throw new Error('Use --database <existing SQLite file> [--apply]');
const path = resolve(values.database);
const db = new DatabaseSync(path, { readOnly: !values.apply });
const seed = JSON.parse(readFileSync(new URL('../seed/seed.json', import.meta.url), 'utf8'));
const block = seed.blockTypes.find(b => b.slug === 'industrial_salt_faq');
const faq = seed.content.business_pages.find(e => e.slug === 'industrial-salt').data.sections.find(b => b._type === block.slug);

function fingerprint(fields) {
  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
    return value;
  }
  const contract = fields.map(f => ({ slug: f.slug, type: f.type, required: f.required ?? false,
    ...(f.defaultValue !== undefined ? { defaultValue: f.defaultValue } : {}),
    ...(f.validation !== undefined ? { validation: f.validation } : {}),
    ...(f.options !== undefined ? { options: f.options } : {}),
  }));
  return `block-type:v1:sha256:${createHash('sha256').update(JSON.stringify(canonical(contract))).digest('hex')}`;
}
function withFaq(sections) {
  if (sections.some(b => b._type === block.slug)) return sections;
  if (sections.some(b => b._key === faq._key)) throw new Error('FAQ block key is already in use');
  const result = [...sections];
  const index = result.findIndex(b => b._type === 'industrial_salt_quote');
  result.splice(index < 0 ? result.length : index, 0, faq);
  return result;
}

try {
  const stored = db.prepare('SELECT * FROM _emdash_block_types WHERE slug=?').get(block.slug);
  const version = block.versions.find(v => v.version === block.currentVersion);
  const existingVersion = stored && db.prepare('SELECT fingerprint FROM _emdash_block_type_versions WHERE block_type_id=? AND version=?').get(stored.id, version.version);
  if (existingVersion && existingVersion.fingerprint !== fingerprint(version.fields)) throw new Error('Immutable FAQ contract conflict');
  const field = db.prepare("SELECT f.* FROM _emdash_fields f JOIN _emdash_collections c ON c.id=f.collection_id WHERE c.slug='business_pages' AND f.slug='sections'").get();
  const validation = JSON.parse(field.validation);
  if (!Array.isArray(validation.allowedTypes)) throw new Error('Unexpected sections validation');
  const addAllowedType = !validation.allowedTypes.includes(block.slug);
  if (addAllowedType) validation.allowedTypes.push(block.slug);
  const pages = db.prepare("SELECT id,sections FROM ec_business_pages WHERE slug='industrial-salt'").all();
  if (!pages.length) throw new Error('Industrial Salt page is missing');
  const entries = pages.map(row => ({ ...row, next: JSON.stringify(withFaq(JSON.parse(row.sections))) })).filter(row => row.next !== row.sections);
  const revisions = pages.flatMap(page => db.prepare("SELECT id,data FROM revisions WHERE collection='business_pages' AND entry_id=?").all(page.id)).map(row => {
    const data = JSON.parse(row.data);
    return { ...row, next: JSON.stringify({ ...data, sections: withFaq(data.sections) }) };
  }).filter(row => row.next !== row.data);
  if (stored && existingVersion && !addAllowedType && !entries.length && !revisions.length) {
    console.log('Already restored; no changes.');
  } else if (!values.apply) {
    console.log(`Dry run: restore FAQ schema, ${entries.length} page entries and ${revisions.length} revisions; existing FAQ blocks stay unchanged.`);
  } else {
    const backupPath = `${path}.industrial-faq-backup-${Date.now()}.sqlite`;
    await backup(db, backupPath);
    db.exec('BEGIN IMMEDIATE');
    try {
      const id = stored?.id ?? randomUUID();
      if (!stored) db.prepare("INSERT INTO _emdash_block_types (id,slug,label,category,current_version,source) VALUES (?,?,?,?,?,'seed')").run(id, block.slug, block.label, block.category, block.currentVersion);
      if (!existingVersion) db.prepare('INSERT INTO _emdash_block_type_versions (id,block_type_id,version,fields,fingerprint) VALUES (?,?,?,?,?)').run(randomUUID(), id, version.version, JSON.stringify(version.fields), fingerprint(version.fields));
      if (addAllowedType) db.prepare('UPDATE _emdash_fields SET validation=? WHERE id=?').run(JSON.stringify(validation), field.id);
      for (const row of entries) db.prepare('UPDATE ec_business_pages SET sections=? WHERE id=?').run(row.next, row.id);
      for (const row of revisions) db.prepare('UPDATE revisions SET data=? WHERE id=?').run(row.next, row.id);
      db.exec('COMMIT');
      console.log(`Restored FAQ to ${entries.length} entries and ${revisions.length} revisions. Backup: ${backupPath}`);
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
} finally { db.close(); }
