const ExcelJS = require('exceljs');

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function unwrapCellValue(value) {
  if (value == null) return '';
  if (value instanceof Date) return value;
  if (typeof value !== 'object') return value;
  if (Object.prototype.hasOwnProperty.call(value, 'result')) return unwrapCellValue(value.result);
  if (Array.isArray(value.richText)) return value.richText.map(part => part.text || '').join('');
  if (value.text != null) return value.text;
  if (value.hyperlink != null) return value.text || value.hyperlink;
  return String(value);
}

async function readFirstWorksheetRows(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.worksheets[0];
  if (!worksheet || worksheet.rowCount < 1) return [];

  const headers = [];
  worksheet.getRow(1).eachCell({ includeEmpty: true }, (cell, columnNumber) => {
    headers[columnNumber] = String(unwrapCellValue(cell.value) || `col_${columnNumber - 1}`).trim();
  });

  const rows = [];
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const sourceRow = worksheet.getRow(rowNumber);
    const row = {};
    let hasValue = false;
    for (let columnNumber = 1; columnNumber < headers.length; columnNumber += 1) {
      const value = unwrapCellValue(sourceRow.getCell(columnNumber).value);
      if (value !== '') hasValue = true;
      row[headers[columnNumber] || `col_${columnNumber - 1}`] = value;
    }
    if (hasValue) rows.push(row);
  }
  return rows;
}

async function buildWorkbookBuffer(rows, sheetName = 'Report') {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Samay';
  workbook.created = new Date();
  const worksheet = workbook.addWorksheet(sheetName, { views: [{ state: 'frozen', ySplit: 1 }] });
  const headers = rows.length ? Object.keys(rows[0]) : [];
  worksheet.columns = headers.map(header => ({
    header,
    key: header,
    width: Math.min(32, Math.max(12, String(header).length + 3))
  }));
  worksheet.addRows(rows);
  worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
  worksheet.getRow(1).alignment = { vertical: 'middle' };
  if (headers.length) {
    worksheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: Math.max(1, rows.length + 1), column: headers.length }
    };
  }
  worksheet.eachRow({ includeEmpty: false }, row => {
    row.eachCell({ includeEmpty: false }, cell => {
      const length = String(unwrapCellValue(cell.value)).length;
      if (cell.col <= worksheet.columns.length) {
        worksheet.getColumn(cell.col).width = Math.min(36, Math.max(worksheet.getColumn(cell.col).width || 12, length + 2));
      }
    });
  });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function rowsToCsv(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const escape = value => {
    const text = String(value == null ? '' : value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [
    headers.map(escape).join(','),
    ...rows.map(row => headers.map(header => escape(row[header])).join(','))
  ].join('\r\n');
}

function isXlsxUpload(file) {
  if (!file) return false;
  const name = String(file.originalname || '').toLowerCase();
  const type = String(file.mimetype || '').toLowerCase();
  return name.endsWith('.xlsx')
    && [XLSX_MIME, 'application/octet-stream', 'application/zip'].includes(type);
}

module.exports = {
  XLSX_MIME,
  buildWorkbookBuffer,
  isXlsxUpload,
  readFirstWorksheetRows,
  rowsToCsv
};
