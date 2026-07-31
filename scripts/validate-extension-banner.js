const assert = require('assert');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.join(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

function listFiles(directory, base = directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(absolute, base));
    else files.push(path.relative(base, absolute).replace(/\\/g, '/'));
  }
  return files.sort();
}

function readZipEntries(buffer) {
  const minimumEocdSize = 22;
  const oldestPossibleEocd = Math.max(0, buffer.length - 65557);
  let eocdOffset = -1;
  for (let offset = buffer.length - minimumEocdSize; offset >= oldestPossibleEocd; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      eocdOffset = offset;
      break;
    }
  }
  assert(eocdOffset >= 0, 'Extension download must be a valid ZIP archive');

  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  let cursor = buffer.readUInt32LE(eocdOffset + 16);
  const entries = new Map();

  for (let index = 0; index < entryCount; index += 1) {
    assert.equal(buffer.readUInt32LE(cursor), 0x02014b50, 'Invalid ZIP central directory');
    const compressionMethod = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const fileNameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer
      .subarray(cursor + 46, cursor + 46 + fileNameLength)
      .toString('utf8')
      .replace(/\\/g, '/');

    if (!name.endsWith('/')) {
      assert.equal(buffer.readUInt32LE(localHeaderOffset), 0x04034b50, 'Invalid ZIP local header');
      const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
      const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
      const content = compressionMethod === 0
        ? compressed
        : compressionMethod === 8
          ? zlib.inflateRawSync(compressed)
          : null;
      assert(content, `Unsupported ZIP compression method for ${name}`);
      assert.equal(content.length, uncompressedSize, `Invalid uncompressed size for ${name}`);
      entries.set(name, content);
    }

    cursor += 46 + fileNameLength + extraLength + commentLength;
  }
  return entries;
}

function validateBannerContract() {
  const page = read('public/timesheet.html');
  const styles = read('public/css/extension-promo.css');
  const serviceWorker = read('public/sw.js');

  assert(page.includes('id="extension-promo"'));
  assert(page.includes('Download extension'));
  assert(page.includes('/downloads/samay-focus-timer-extension-1.0.0.zip'));
  assert(page.includes('id="extension-install-guide" hidden'));
  assert(page.includes('samay_extension_promo_dismissed_v1'));
  assert(page.includes('function dismissExtensionPromo()'));
  assert(page.includes('function toggleExtensionInstallGuide()'));
  assert(page.includes("localStorage.setItem(EXTENSION_PROMO_DISMISSED_KEY, '1')"));
  assert(styles.includes('.extension-promo[hidden]'));
  assert(styles.includes('@media (max-width: 620px)'));
  assert(styles.includes('grid-template-columns: 1fr'));
  assert(serviceWorker.includes("const CACHE_NAME = 'samay-v15'"));
  assert(serviceWorker.includes("'/css/extension-promo.css?v=1'"));
}

function validatePublishedPackage() {
  const archivePath = path.join(root, 'public', 'downloads', 'samay-focus-timer-extension-1.0.0.zip');
  assert(fs.existsSync(archivePath), 'Public extension ZIP must exist');
  const archiveEntries = readZipEntries(fs.readFileSync(archivePath));
  const sourceRoot = path.join(root, 'extension');
  const sourceFiles = listFiles(sourceRoot);
  const archiveFiles = [...archiveEntries.keys()].sort();
  assert.deepEqual(archiveFiles, sourceFiles, 'Published ZIP contents must match extension source');

  for (const relativePath of sourceFiles) {
    const source = fs.readFileSync(path.join(sourceRoot, relativePath));
    assert(archiveEntries.get(relativePath).equals(source), `${relativePath} differs in the published ZIP`);
    assert(!/(^|\/)(\.env|credentials|secrets?)(\.|\/|$)/i.test(relativePath), `Sensitive file included: ${relativePath}`);
  }
}

validateBannerContract();
validatePublishedPackage();
console.log('Extension banner and published package validation passed.');
