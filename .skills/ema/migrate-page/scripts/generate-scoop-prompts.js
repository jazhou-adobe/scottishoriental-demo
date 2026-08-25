/**
 * Generate one subagent task config per block for page migration.
 *
 * Usage (Node CLI): node generate-scoop-prompts.js <migration-dir> [model]
 *   Prints a JSON array of { name, model, prompt } — one task per block,
 *   ready to dispatch as parallel subagents.
 *
 * @param {object} decomposition - The decomposition.json content (parsed)
 * @param {string} sourceUrl - The source page URL
 * @param {string} projectPath - The EDS project root (e.g., the cloned repo dir)
 * @param {string} [model='claude-opus-4-6'] - Model ID for the block subagents.
 * @returns {Array<{name: string, model: string, prompt: string}>}
 */
function generateScoopConfigs(decomposition, sourceUrl, projectPath, model = 'claude-opus-4-6') {
  const configs = [];

  for (const fragment of decomposition.fragments) {
    for (const child of fragment.children || []) {
      if (child.type === 'default-content') continue;

      const blocks = child.type === 'section'
        ? (child.children || []).filter(c => c.type === 'block')
        : [child];

      for (const block of blocks) {
        const isHeader = block.name === 'nav-bar' || block.name === 'header'
          || block.name === 'navigation' || fragment.path === '/nav';
        const isFooter = block.name === 'footer' || block.name === 'footer-links'
          || block.name === 'footer-content' || fragment.path === '/footer';

        const scoopName = block.name + '-block';
        const bounds = block.bounds
          ? `x=${block.bounds.x}, y=${block.bounds.y}, width=${block.bounds.width}, height=${block.bounds.height}`
          : 'unknown';

        let prompt;

        if (isHeader) {
          prompt = buildHeaderPrompt(block, sourceUrl, projectPath, bounds);
        } else if (isFooter) {
          prompt = buildFooterPrompt(block, sourceUrl, projectPath, bounds);
        } else {
          prompt = buildBlockPrompt(block, sourceUrl, projectPath, bounds);
        }

        const config = { name: scoopName, prompt };
        if (model) config.model = model;
        configs.push(config);
      }
    }
  }

  return configs;
}

function buildBlockPrompt(block, sourceUrl, projectPath, bounds) {
  return `You are migrating a single block to EDS.

## Parameters
- Block name: ${block.name}
- Source URL: ${sourceUrl}
- Visual tree ID: ${block.id || 'unknown'}
- Bounds: ${bounds}
- EDS project: ${projectPath}
- Notes: ${block.notes || block.style || ''}

## Instructions
Read slicc-migration/migrate-block/SKILL.md and follow every step.
The skill tells you how to read head.html from the project.
Do NOT inline CSS or JS as a substitute for the EDS framework.`;
}

function buildHeaderPrompt(block, sourceUrl, projectPath, bounds) {
  return `You are migrating the website header/navigation to EDS.

## Parameters
- Source URL: ${sourceUrl}
- EDS project: ${projectPath}
- Bounds: ${bounds}
- Notes: ${block.notes || block.style || ''}

## Instructions
Read slicc-migration/migrate-header/SKILL.md and follow it exactly.
This is a HEADER migration, not a regular block. Follow the header skill
exactly — it handles nav.plain.html generation, section-metadata styles,
dropdown detection, and header-specific CSS patterns.`;
}

function buildFooterPrompt(block, sourceUrl, projectPath, bounds) {
  return `You are migrating a single block to EDS.

## Parameters
- Block name: ${block.name}
- Source URL: ${sourceUrl}
- Visual tree ID: ${block.id || 'unknown'}
- Bounds: ${bounds}
- EDS project: ${projectPath}
- Special: This is the FOOTER block. Output footer.plain.html, not ${block.name}.plain.html. See "Footer Block — Special Case" in the migrate-block skill.
- Notes: ${block.notes || block.style || ''}

## Instructions
Read slicc-migration/migrate-block/SKILL.md and follow every step.
The skill tells you how to read head.html from the project.
Do NOT inline CSS or JS as a substitute for the EDS framework.`;
}

// Export for use when eval'd by another script
if (typeof module !== 'undefined') module.exports = { generateScoopConfigs };

// CLI: node generate-scoop-prompts.js <migration-dir> [model]
if (typeof require !== 'undefined' && require.main === module) {
  const nodeFs = require('fs');
  const migrationDir = process.argv[2];
  const decomposition = JSON.parse(
    nodeFs.readFileSync(migrationDir + '/decomposition.json', 'utf-8')
  );
  const projectPath = migrationDir.replace(/\/\.migration\/?$/, '');
  const model = process.argv[3] || 'claude-opus-4-6';
  const configs = generateScoopConfigs(
    decomposition, decomposition.url, projectPath, model
  );
  console.log(JSON.stringify(configs));
}
