/**
 * Scan an EDS project's blocks/ directory for available blocks.
 *
 * Standard Node CLI — no SLICC globals.
 *
 * Usage:
 *   node block-inventory.js <project-path>
 *   # writes <project-path>/.migration/block-inventory.json and prints a summary
 */
const fs = require('fs');
const path = require('path');

function scanBlockInventory(projectPath) {
  const blocksDir = path.join(projectPath, 'blocks');
  const entries = [];

  let dirEntries;
  try {
    dirEntries = fs.readdirSync(blocksDir, { withFileTypes: true });
  } catch (e) {
    return entries;
  }

  for (const entry of dirEntries) {
    if (!entry.isDirectory()) continue;

    const name = entry.name;
    const blockDir = path.join(blocksDir, name);

    let files;
    try {
      files = fs.readdirSync(blockDir);
    } catch (e) {
      continue;
    }

    const hasJs = files.includes(`${name}.js`);
    const hasCss = files.includes(`${name}.css`);
    if (!hasJs && !hasCss) continue;

    let jsSize;
    let cssSize;
    if (hasJs) jsSize = fs.readFileSync(path.join(blockDir, `${name}.js`), 'utf-8').length;
    if (hasCss) cssSize = fs.readFileSync(path.join(blockDir, `${name}.css`), 'utf-8').length;

    entries.push({ name, hasJs, hasCss, jsSize, cssSize });
  }

  return entries;
}

if (typeof module !== 'undefined') module.exports = { scanBlockInventory };

// CLI: node block-inventory.js <project-path>
if (typeof require !== 'undefined' && require.main === module) {
  const projectPath = process.argv[2];
  const blocks = scanBlockInventory(projectPath);
  const outDir = path.join(projectPath, '.migration');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'block-inventory.json'),
    JSON.stringify(blocks, null, 2),
  );
  console.log(JSON.stringify({
    blockCount: blocks.length,
    blocks: blocks.map((b) => b.name),
  }));
}
