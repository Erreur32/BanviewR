#!/usr/bin/env node
// Sets the version in package.json and package-lock.json, then turns "## [Unreleased]"
// in CHANGELOG.md into the release section and opens a new one. Runs no command.
// Usage: npm run release -- <x.y.z|patch|minor|major>
import { readFileSync, writeFileSync } from 'node:fs';

const wanted = process.argv[2] ?? '';
const changelog = readFileSync('CHANGELOG.md', 'utf8');
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

function next(current, step) {
  if (/^\d+\.\d+\.\d+$/.test(step)) return step;
  const [major, minor, patch] = current.split('.').map(Number);
  if (step === 'major') return `${major + 1}.0.0`;
  if (step === 'minor') return `${major}.${minor + 1}.0`;
  if (step === 'patch') return `${major}.${minor}.${patch + 1}`;
  return null;
}

const version = next(pkg.version, wanted);
if (!version || version === pkg.version) {
  console.error('Usage: npm run release -- <x.y.z|patch|minor|major>, different from the current version');
  process.exit(1);
}
if (!changelog.includes('## [Unreleased]')) {
  console.error('CHANGELOG.md has no "## [Unreleased]" section');
  process.exit(1);
}

const write = (file, data) => writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
write('package.json', { ...pkg, version });
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
lock.version = version;
lock.packages[''].version = version;
write('package-lock.json', lock);

const today = new Date().toISOString().slice(0, 10);
writeFileSync('CHANGELOG.md', changelog.replace('## [Unreleased]', `## [Unreleased]\n\n## [${version}] - ${today}`));
console.log(version);
