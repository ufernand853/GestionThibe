function escapeCell(value) {
  if (value === null || value === undefined) {
    return '';
  }
  const stringValue = String(value);
  if (stringValue.includes(';') || stringValue.includes('"') || stringValue.includes('\n')) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

export function exportToCsv(filename, rows) {
  if (!rows || rows.length === 0) {
    return;
  }
  const headers = Object.keys(rows[0]);
  const csvLines = [headers.join(';')];
  rows.forEach(row => {
    const line = headers.map(header => escapeCell(row[header])).join(';');
    csvLines.push(line);
  });
  const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
