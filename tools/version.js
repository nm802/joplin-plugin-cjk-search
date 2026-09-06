/*
 * manifest.json と package.json のバージョンを揃え、.jpl にバージョン入りの名前を付ける。
 *
 * 差し替えたときに「どのビルドが入っているのか」が分からなくなるのを防ぐ。
 * ダイアログにも同じ値を出しているので、実機で見えている版と手元の版を突き合わせられる。
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const manifestPath = path.join(root, 'src', 'manifest.json');
const packagePath = path.join(root, 'package.json');

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const writeJson = (p, v) => fs.writeFileSync(p, `${JSON.stringify(v, null, '\t')}\n`);

const bump = (version, part) => {
  const [major, minor, patch] = version.split('.').map(Number);
  if (part === 'major') return `${major + 1}.0.0`;
  if (part === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
};

const command = process.argv[2];

if (command === 'bump') {
  const manifest = readJson(manifestPath);
  const next = bump(manifest.version, process.argv[3] || 'patch');
  manifest.version = next;
  writeJson(manifestPath, manifest);
  const pkg = readJson(packagePath);
  pkg.version = next;
  fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(next);
} else if (command === 'stamp') {
  // ビルド後の .jpl にバージョン入りの複製を作る。元のファイル名は Joplin の慣習に従い変えない。
  const manifest = readJson(manifestPath);
  const src = path.join(root, 'publish', `${manifest.id}.jpl`);
  const dest = path.join(root, 'publish', `${manifest.id}-${manifest.version}.jpl`);
  fs.copyFileSync(src, dest);
  console.log(`v${manifest.version}  ${dest}`);
} else {
  console.log(readJson(manifestPath).version);
}
