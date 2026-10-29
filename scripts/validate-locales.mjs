import { readFile } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';
const root = new URL('../extension/locales/', import.meta.url);
const localeNames = (await readdir(root, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

if (!localeNames.includes('en-US')) {
  throw new Error('Missing required fallback locale: en-US');
}

const load = async (locale) => JSON.parse(await readFile(new URL(`${locale}/messages.json`, root), 'utf8'));
const catalogs = Object.fromEntries(await Promise.all(localeNames.map(async (locale) => [locale, await load(locale)])));
const baseKeys = Object.keys(catalogs['en-US']).sort();
const placeholders = (value) => [...String(value).matchAll(/\{(\d+)\}/g)].map((match) => match[1]).sort();
const errors = [];

for (const [locale, catalog] of Object.entries(catalogs)) {
  const keys = Object.keys(catalog).sort();
  const missing = baseKeys.filter((key) => !keys.includes(key));
  const extra = keys.filter((key) => !baseKeys.includes(key));
  if (missing.length) errors.push(`${locale}: missing keys: ${missing.join(', ')}`);
  if (extra.length) errors.push(`${locale}: unexpected keys: ${extra.join(', ')}`);
  for (const key of baseKeys) {
    const entry = catalog[key];
    if (!entry || typeof entry.message !== 'string' || !entry.message.trim()) {
      errors.push(`${locale}.${key}: message must be a non-empty string`);
      continue;
    }
    if (typeof entry.description !== 'string' || !entry.description.trim()) {
      errors.push(`${locale}.${key}: description must be a non-empty string`);
    }
    if (JSON.stringify(placeholders(entry.message)) !== JSON.stringify(placeholders(catalogs['en-US'][key].message))) {
      errors.push(`${locale}.${key}: placeholders must match en-US`);
    }
  }
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Validated ${localeNames.length} locales and ${baseKeys.length} messages.`);
}
