#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const bcrypt = require('bcryptjs');
const { getDefaultPermissions } = require('../js/permissions');

const DEFAULT_XLSX = path.resolve('E:/AI Projects/New folder/Attendance.xlsx');
const EXTRACTOR = path.join(__dirname, 'attendance-extract.py');

function parseArgs(argv) {
  const args = { file: null, json: null, dryRun: false };
  for (let i = 2; i < argv.length; i += 1) {
    const current = argv[i];
    if (current === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if ((current === '--file' || current === '-f') && argv[i + 1]) {
      args.file = path.resolve(argv[i + 1]);
      i += 1;
      continue;
    }
    if ((current === '--json' || current === '--input-json') && argv[i + 1]) {
      args.json = path.resolve(argv[i + 1]);
      i += 1;
      continue;
    }
    if (!current.startsWith('--') && !args.file) {
      args.file = path.resolve(current);
    }
  }
  if (!args.file) args.file = DEFAULT_XLSX;
  return args;
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function uniqueUsername(base, existing) {
  const cleaned = slugify(base) || 'attendance-user';
  let candidate = cleaned;
  let counter = 2;
  while (existing.has(candidate)) {
    candidate = `${cleaned}-${counter}`;
    counter += 1;
  }
  existing.add(candidate);
  return candidate;
}

function runExtractor(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Workbook not found: ${filePath}`);
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'attendance-import-'));
  const outputPath = path.join(tempDir, `${crypto.randomUUID()}.json`);
  const candidates = [
    ['py', ['-3', EXTRACTOR, filePath, '--output', outputPath]],
    ['python', [EXTRACTOR, filePath, '--output', outputPath]],
    ['python3', [EXTRACTOR, filePath, '--output', outputPath]]
  ];

  let lastError = null;
  for (const [command, args] of candidates) {
    if (fs.existsSync(outputPath)) {
      fs.rmSync(outputPath, { force: true });
    }
    const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
    if (result.status === 0 && fs.existsSync(outputPath)) {
      const payload = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
      fs.rmSync(tempDir, { recursive: true, force: true });
      return payload;
    }
    lastError = [
      `Command: ${command} ${args.map(arg => JSON.stringify(arg)).join(' ')}`,
      result.error ? `Error: ${result.error.message}` : null,
      result.stderr ? `Stderr: ${result.stderr}` : null,
      result.stdout ? `Stdout: ${result.stdout}` : null
    ].filter(Boolean).join('\n');
  }

  fs.rmSync(tempDir, { recursive: true, force: true });
  throw new Error(lastError || 'Unable to parse workbook');
}

function loadWorkbookJson(jsonPath) {
  if (!fs.existsSync(jsonPath)) {
    throw new Error(`Workbook JSON not found: ${jsonPath}`);
  }
  return JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
}

async function loadFirestore() {
  try {
    const { db, admin } = require('../functions/db');
    return { db, admin };
  } catch (error) {
    throw new Error(`Firestore is not available in this environment: ${error.message}`);
  }
}

function sheetCollectionName(sheetName) {
  const normalized = slugify(sheetName);
  const mapping = {
    attendance: 'attendance_records',
    leaves: 'leave_records',
    'shift-masters': 'shift_masters',
    'location-master': 'location_master',
    'bulk-leave': 'bulk_leave',
    'deleted-rows-log': 'deleted_rows_log',
    holidays: 'holidays'
  };
  return mapping[normalized] || normalized;
}

function buildDocId(sheetName, row) {
  const prefix = sheetCollectionName(sheetName);
  const rowNumber = String(row.rowNumber || 0).padStart(5, '0');
  if (prefix === 'attendance_records') {
    return [
      prefix,
      row.Date || 'unknown-date',
      normalizeDocIdPart(row.Name || 'record'),
      rowNumber
    ].join('_');
  }
  if (prefix === 'leave_records') {
    return [
      prefix,
      row.Date || 'unknown-date',
      normalizeDocIdPart(row.Name || 'record'),
      rowNumber
    ].join('_');
  }
  if (prefix === 'location_master') {
    return `${prefix}_${normalizeDocIdPart(row.Location || row.Name || `row-${rowNumber}`)}`;
  }
  if (prefix === 'shift_masters') {
    return `${prefix}_${normalizeDocIdPart(row.Location || `row-${rowNumber}`)}`;
  }
  if (prefix === 'holidays') {
    return `${prefix}_${row.Date || 'unknown-date'}_${normalizeDocIdPart(row.Particulars || `row-${rowNumber}`)}`;
  }
  if (prefix === 'deleted_rows_log') {
    return `${prefix}_${normalizeDocIdPart(row.Timestamp || `row-${rowNumber}`)}_${rowNumber}`;
  }
  if (prefix === 'bulk_leave') {
    return `${prefix}_${normalizeDocIdPart(row.Name || `row-${rowNumber}`)}_${normalizeDocIdPart(row['From Date'] || 'from')}_${normalizeDocIdPart(row['To Date'] || 'to')}_${rowNumber}`;
  }
  return `${prefix}_${rowNumber}`;
}

async function ensureUsers(db, admin, uniqueNames) {
  const usersSnap = await db.collection('users').get();
  const byName = new Map();
  const usernames = new Set();

  usersSnap.forEach(doc => {
    const data = doc.data();
    const nameKey = String(data.name || '').trim().toLowerCase();
    const usernameKey = String(data.username || '').trim().toLowerCase();
    if (nameKey) byName.set(nameKey, { id: doc.id, data });
    if (usernameKey) usernames.add(usernameKey);
  });

  const createdUsers = [];
  const userRefs = new Map();
  const defaultPermissions = getDefaultPermissions('article');

  for (const name of uniqueNames) {
    const key = String(name || '').trim().toLowerCase();
    const existing = byName.get(key);
    if (existing) {
      userRefs.set(key, existing.id);
      continue;
    }

    const username = uniqueUsername(name, usernames);
    const docId = `attendance-${username}`;
    const password = await bcrypt.hash(`attendance-${username}-${Date.now()}`, 10);
    const payload = {
      name,
      username,
      password,
      role: 'article',
      permissions: defaultPermissions,
      email: '',
      mobile_number: '',
      mfa_secret: '',
      mfa_enabled: false,
      mfa_recovery_code_hashes: [],
      designation: 'Imported attendance user',
      department: 'Attendance',
      active: false,
      source: 'attendance-import',
      created_at: admin.firestore.FieldValue.serverTimestamp()
    };
    await db.collection('users').doc(docId).set(payload, { merge: true });
    createdUsers.push({ id: docId, name, username });
    userRefs.set(key, docId);
  }

  return { userRefs, createdUsers };
}

function normalizeDocIdPart(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 48) || 'record';
}

function toNumber(value) {
  if (value === '' || value == null) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

async function commitSheetRows(db, admin, sheet, userRefs, sourceFile) {
  let written = 0;
  const batchSize = 400;
  const collectionName = sheetCollectionName(sheet.sheetName);

  for (let index = 0; index < sheet.rows.length; index += batchSize) {
    const batch = db.batch();
    const chunk = sheet.rows.slice(index, index + batchSize);

    for (const row of chunk) {
      const docId = buildDocId(sheet.sheetName, row);
      const payload = {
        source_file: sourceFile,
        source_sheet: sheet.sheetName,
        source_row: row.rowNumber || 0,
        imported_at: admin.firestore.FieldValue.serverTimestamp(),
        ...row
      };

      const personName = String(row.Name || '').trim();
      if (personName) {
        const userId = userRefs.get(personName.toLowerCase()) || null;
        payload.user_id = userId;
        payload.person_name = personName;
      }

      batch.set(db.collection(collectionName).doc(docId), payload, { merge: true });
      written += 1;
    }

    await batch.commit();
  }

  return written;
}

function collectUniqueNames(sheets) {
  return sheets.reduce((acc, sheet) => {
    for (const row of sheet.rows || []) {
      const name = String(row.Name || '').trim();
      if (name) acc.add(name);
    }
    return acc;
  }, new Set());
}

function printSheetSummary(workbook) {
  console.log(`Workbook: ${workbook.sourceFile}`);
  console.log(`Sheets imported: ${workbook.sheetCount}`);
  workbook.sheets.forEach(sheet => {
    console.log(`- ${sheet.sheetName}: ${sheet.rowCount} rows`);
  });
  console.log(`Unique people: ${workbook.uniqueNames.length}`);
}

async function main() {
  const args = parseArgs(process.argv);
  const workbook = args.json ? loadWorkbookJson(args.json) : runExtractor(args.file);
  printSheetSummary(workbook);

  if (args.dryRun) {
    console.log('Dry run only. No Firestore writes will be made.');
    return;
  }

  const { db, admin } = await loadFirestore();
  const uniqueNames = [...collectUniqueNames(workbook.sheets || [])];
  const { userRefs, createdUsers } = await ensureUsers(db, admin, uniqueNames);

  let written = 0;
  for (const sheet of workbook.sheets || []) {
    written += await commitSheetRows(db, admin, sheet, userRefs, path.basename(args.file));
  }

  console.log(`Created inactive users: ${createdUsers.length}`);
  console.log(`Rows written: ${written}`);
}

main().catch(error => {
  console.error(error.message || error);
  process.exitCode = 1;
});
