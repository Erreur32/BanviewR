#!/usr/bin/env node
// Sets the version: package.json and package-lock.json through npm, then turns
// "## [Unreleased]" in CHANGELOG.md into the release section and opens a new one.
// Usage: npm run release -- <x.y.z|patch|minor|major>
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const wanted = process.argv[2];
if (!wanted || !/^(\d+\.\d+\.\d+|patch|minor|major)$/.test(wanted)) {
  console.error('Usage: npm run release -- <x.y.z|patch|minor|major>');
  process.exit(1);
}

const changelog = readFileSync('CHANGELOG.md', 'utf8');
if (!changelog.includes('## [Unreleased]')) {
  console.error('CHANGELOG.md has no "## [Unreleased]" section');
  process.exit(1);
}

execFileSync('npm', ['version', wanted, '--no-git-tag-version'], { stdio: 'ignore' });
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const today = new Date().toISOString().slice(0, 10);
writeFileSync('CHANGELOG.md', changelog.replace('## [Unreleased]', `## [Unreleased]\n\n## [${version}] - ${today}`));

console.log(version);
