import { readFileSync } from 'node:fs';

export function loadModuleSource(relativePath, metaUrl) {
  return readFileSync(new URL(relativePath, metaUrl), 'utf8');
}

export function normalizeWhitespace(source) {
  return String(source || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function hasImportedBinding(source, importSource, bindingName) {
  const importPattern = new RegExp(
    `import\\s+([\\s\\S]*?)\\s+from\\s+['"]${escapeRegExp(importSource)}['"]`,
    'm'
  );
  const match = String(source || '').match(importPattern);
  if (!match) {
    return false;
  }

  const clause = match[1] || '';
  if (!bindingName) {
    return clause.trim().length > 0;
  }

  const normalizedClause = normalizeWhitespace(clause);
  const bindingPattern = new RegExp(`\\b${escapeRegExp(bindingName)}\\b`);
  return bindingPattern.test(normalizedClause);
}

export function countOccurrences(source, needle) {
  if (!needle) return 0;
  return String(source || '').split(String(needle)).length - 1;
}

export function getCallSource(source, calleeName) {
  const sourceText = String(source || '');
  const callStart = sourceText.indexOf(`${calleeName}(`);
  if (callStart < 0) {
    throw new Error(`Call not found: ${calleeName}`);
  }

  let depth = 0;
  let started = false;
  for (let index = callStart; index < sourceText.length; index += 1) {
    const char = sourceText[index];
    if (char === '(') {
      depth += 1;
      started = true;
    } else if (char === ')') {
      depth -= 1;
      if (started && depth === 0) {
        return sourceText.slice(callStart, index + 1);
      }
    }
  }

  throw new Error(`Unterminated call: ${calleeName}`);
}

export function getConstArrayItems(source, constName) {
  const sourceText = String(source || '');
  const match = sourceText.match(new RegExp(`const\\s+${escapeRegExp(constName)}\\s*=\\s*\\[([\\s\\S]*?)\\];`, 'm'));
  if (!match) {
    throw new Error(`Array constant not found: ${constName}`);
  }

  return [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map((entry) => entry[1]);
}
