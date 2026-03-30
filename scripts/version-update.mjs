#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = process.cwd();
const bumpArg = (process.argv[2] || process.env.BUMP || 'patch').toLowerCase();
const allowed = new Set(['patch', 'minor', 'major']);

if (!allowed.has(bumpArg)) {
  console.error(`Invalid bump type: ${bumpArg}. Use patch|minor|major.`);
  process.exit(1);
}

const packageJsonPath = path.join(ROOT, 'package.json');
const tauriJsonPath = path.join(ROOT, 'src-tauri', 'tauri.conf.json');
const cargoTomlPath = path.join(ROOT, 'src-tauri', 'Cargo.toml');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readCargoVersion(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const m = raw.match(/(^version\s*=\s*"(\d+\.\d+\.\d+)"\s*$)/m);
  if (!m) throw new Error(`Could not find Cargo package version in ${file}`);
  return m[2];
}

function writeCargoVersion(file, version) {
  const raw = fs.readFileSync(file, 'utf8');
  const updated = raw.replace(/(^version\s*=\s*")(\d+\.\d+\.\d+)("\s*$)/m, `$1${version}$3`);
  if (updated === raw) throw new Error(`Failed to update Cargo version in ${file}`);
  fs.writeFileSync(file, updated);
}

function bumpSemver(version, bumpType) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  if (!match) throw new Error(`Unsupported version format: ${version}`);

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);

  if (bumpType === 'major') return `${major + 1}.0.0`;
  if (bumpType === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function assertVersionAlignment() {
  const pkgVersion = readJson(packageJsonPath).version;
  const tauriVersion = readJson(tauriJsonPath).version;
  const cargoVersion = readCargoVersion(cargoTomlPath);

  if (!(pkgVersion === tauriVersion && tauriVersion === cargoVersion)) {
    throw new Error(
      `Version mismatch: package.json=${pkgVersion}, tauri.conf.json=${tauriVersion}, Cargo.toml=${cargoVersion}`,
    );
  }

  return pkgVersion;
}

function createTag(version) {
  const tag = `v${version}`;
  const exists = execSync(`git tag -l ${tag}`, { encoding: 'utf8' }).trim();
  if (exists) {
    throw new Error(`Git tag already exists: ${tag}`);
  }
  execSync(`git tag -a ${tag} -m "Release ${version}"`, { stdio: 'inherit' });
  return tag;
}

try {
  const current = assertVersionAlignment();
  const next = bumpSemver(current, bumpArg);

  const pkg = readJson(packageJsonPath);
  pkg.version = next;
  fs.writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`);

  const tauri = readJson(tauriJsonPath);
  tauri.version = next;
  fs.writeFileSync(tauriJsonPath, `${JSON.stringify(tauri, null, 2)}\n`);

  writeCargoVersion(cargoTomlPath, next);

  assertVersionAlignment();

  const tag = createTag(next);
  console.log(`Updated version: ${current} -> ${next}`);
  console.log(`Created git tag: ${tag}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
