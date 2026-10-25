// Writes GOOGLE_MAPS_API_KEY into the deployed copy of config.js.
// Usage: GOOGLE_MAPS_API_KEY=... node scripts/inject-key.mjs _site/config.js
import { readFileSync, writeFileSync } from 'node:fs';

const file = process.argv[2];
const key = (process.env.GOOGLE_MAPS_API_KEY ?? '').trim();
const placeholder = "googleMapsApiKey: ''";

const source = readFileSync(file, 'utf8');
if (!source.includes(placeholder)) {
  console.error(`${file} must contain ${placeholder} (is a key committed there?)`);
  process.exit(1);
}
if (!key) {
  // GitHub Actions annotation: shows up as a warning on the run.
  console.log('::warning::GOOGLE_MAPS_API_KEY secret is not set; the site will run in demo mode.');
  process.exit(0);
}
writeFileSync(file, source.replace(placeholder, `googleMapsApiKey: ${JSON.stringify(key)}`));
console.log('API key added to', file);
