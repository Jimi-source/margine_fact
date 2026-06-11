function findHeaderRow(rows, requiredHeaders) {
  const required = requiredHeaders.map(normalizeHeader);
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row || row.length === 0) continue;
    const normalized = row.map(normalizeHeader);
    const matches = required.every((header) => normalized.includes(header));
    if (matches) {
      return i;
    }
  }
  return -1;
}

function scoreHeaderRow(row, schema) {
  if (!row || row.length === 0) return { score: 0, matched: 0, missing: 0 };
  const normalized = row.map(normalizeKey);
  let matched = 0;
  let requiredMissing = 0;
  schema.forEach((item) => {
    const found = item.keys.some((key) =>
      normalized.some((cell) => cell.includes(key))
    );
    if (found) {
      matched += 1;
    } else if (item.required) {
      requiredMissing += 1;
    }
  });
  return { score: matched, matched, missing: requiredMissing };
}

function pickBestHeaderRow(rows, schema) {
  let best = { idx: -1, score: 0, missing: Infinity };
  for (let i = 0; i < rows.length; i += 1) {
    const { score, missing } = scoreHeaderRow(rows[i], schema);
    if (score > best.score || (score === best.score && missing < best.missing)) {
      best = { idx: i, score, missing };
    }
  }
  return best;
}

function columnToIndex(label) {
  let index = 0;
  for (let i = 0; i < label.length; i += 1) {
    const code = label.charCodeAt(i);
    if (code < 65 || code > 90) continue;
    index = index * 26 + (code - 64);
  }
  return index;
}

function parseWorksheetXmlToRows(xmlText, sharedStrings) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "application/xml");
  const rowNodes = Array.from(doc.getElementsByTagName("row"));
  const rows = [];
  rowNodes.forEach((rowNode) => {
    const rowIndex = Number(rowNode.getAttribute("r")) || rows.length + 1;
    const row = [];
    const cells = Array.from(rowNode.getElementsByTagName("c"));
    let implicitCol = 1;
    cells.forEach((cell) => {
      const ref = cell.getAttribute("r");
      const type = cell.getAttribute("t");
      let colIndex = implicitCol;
      if (ref) {
        const colLabel = ref.replace(/[0-9]/g, "").toUpperCase();
        colIndex = columnToIndex(colLabel) || implicitCol;
      }
      implicitCol = colIndex + 1;
      let value = "";
      if (type === "inlineStr") {
        const tNode = cell.getElementsByTagName("t")[0];
        value = tNode ? tNode.textContent || "" : "";
      } else {
        const vNode = cell.getElementsByTagName("v")[0];
        value = vNode ? vNode.textContent || "" : "";
        if (type === "s") {
          const idx = Number(value);
          value = sharedStrings[idx] ?? "";
        } else if (type !== "str" && value !== "" && !Number.isNaN(Number(value))) {
          value = Number(value);
        }
      }
      row[colIndex - 1] = value;
    });
    for (let i = 0; i < row.length; i += 1) {
      if (row[i] === undefined) row[i] = "";
    }
    rows[rowIndex - 1] = row;
  });
  return rows.map((row) => row || []);
}

function buildRowsFromWorkbookFiles(workbook) {
  if (!workbook || !workbook.files) return null;
  const getFileText = (path) => {
    const entry = workbook.files[path];
    if (!entry || !entry.content) return null;
    if (typeof entry.content === "string") return entry.content;
    try {
      return new TextDecoder("utf-8").decode(entry.content);
    } catch (error) {
      return null;
    }
  };
  const workbookXml = getFileText("xl/workbook.xml");
  const relsXml = getFileText("xl/_rels/workbook.xml.rels");
  if (!workbookXml || !relsXml) return null;
  const parser = new DOMParser();
  const wbDoc = parser.parseFromString(workbookXml, "application/xml");
  const sheet = wbDoc.getElementsByTagName("sheet")[0];
  if (!sheet) return null;
  const relId = sheet.getAttribute("r:id") || sheet.getAttribute("id");
  if (!relId) return null;
  const relsDoc = parser.parseFromString(relsXml, "application/xml");
  const relationships = Array.from(relsDoc.getElementsByTagName("Relationship"));
  const rel = relationships.find((item) => item.getAttribute("Id") === relId);
  if (!rel) return null;
  let target = rel.getAttribute("Target") || "";
  if (target.startsWith("/")) target = target.slice(1);
  if (!target.startsWith("xl/")) target = `xl/${target}`;
  const sheetXml = getFileText(target);
  if (!sheetXml) return null;
  const sharedXml = getFileText("xl/sharedStrings.xml");
  let sharedStrings = [];
  if (sharedXml) {
    const sharedDoc = parser.parseFromString(sharedXml, "application/xml");
    sharedStrings = Array.from(sharedDoc.getElementsByTagName("si")).map((si) => {
      const texts = Array.from(si.getElementsByTagName("t")).map(
        (node) => node.textContent || ""
      );
      return texts.join("");
    });
  }
  return parseWorksheetXmlToRows(sheetXml, sharedStrings);
}

function fixCyrillicMojibake(value) {
  if (typeof value !== "string" || value.length === 0) return value;
  const bytes = Uint8Array.from(
    Array.from(value, (ch) => ch.charCodeAt(0) & 0xff)
  );
  const countCyrillic = (text) => (text.match(/[А-Яа-яЁё]/g) || []).length;
  const countReplacement = (text) => (text.match(/�/g) || []).length;
  const scoreText = (text) =>
    countCyrillic(text) * 3 - countReplacement(text);

  const tryDecoders = [];
  if (typeof TextDecoder === "function") {
    ["windows-1251", "ibm866", "koi8-r", "x-mac-cyrillic", "iso-8859-5"].forEach(
      (encoding) => {
        try {
          const decoder = new TextDecoder(encoding, { fatal: false });
          tryDecoders.push((data) => decoder.decode(data));
        } catch (error) {
          // ignore unsupported encodings
        }
      }
    );
  }

  let bestText = value;
  let bestScore = scoreText(value);
  tryDecoders.forEach((decode) => {
    const text = decode(bytes);
    const score = scoreText(text);
    if (score > bestScore) {
      bestScore = score;
      bestText = text;
    }
  });

  const cp1251Table = [
    0x0402, 0x0403, 0x201a, 0x0453, 0x201e, 0x2026, 0x2020, 0x2021,
    0x20ac, 0x2030, 0x0409, 0x2039, 0x040a, 0x040c, 0x040b, 0x040f,
    0x0452, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
    0x0000, 0x2122, 0x0459, 0x203a, 0x045a, 0x045c, 0x045b, 0x045f,
    0x00a0, 0x040e, 0x045e, 0x0408, 0x00a4, 0x0490, 0x00a6, 0x00a7,
    0x0401, 0x00a9, 0x0404, 0x00ab, 0x00ac, 0x00ad, 0x00ae, 0x0407,
    0x00b0, 0x00b1, 0x0406, 0x0456, 0x0491, 0x00b5, 0x00b6, 0x00b7,
    0x0451, 0x2116, 0x0454, 0x00bb, 0x0458, 0x0405, 0x0455, 0x0457,
    0x0410, 0x0411, 0x0412, 0x0413, 0x0414, 0x0415, 0x0416, 0x0417,
    0x0418, 0x0419, 0x041a, 0x041b, 0x041c, 0x041d, 0x041e, 0x041f,
    0x0420, 0x0421, 0x0422, 0x0423, 0x0424, 0x0425, 0x0426, 0x0427,
    0x0428, 0x0429, 0x042a, 0x042b, 0x042c, 0x042d, 0x042e, 0x042f,
    0x0430, 0x0431, 0x0432, 0x0433, 0x0434, 0x0435, 0x0436, 0x0437,
    0x0438, 0x0439, 0x043a, 0x043b, 0x043c, 0x043d, 0x043e, 0x043f,
    0x0440, 0x0441, 0x0442, 0x0443, 0x0444, 0x0445, 0x0446, 0x0447,
    0x0448, 0x0449, 0x044a, 0x044b, 0x044c, 0x044d, 0x044e, 0x044f
  ];
  const decoded = Array.from(bytes)
    .map((byte) => {
      if (byte < 0x80) return String.fromCharCode(byte);
      const mapped = cp1251Table[byte - 0x80];
      return mapped ? String.fromCharCode(mapped) : "";
    })
    .join("");
  if (scoreText(decoded) > bestScore) {
    bestScore = scoreText(decoded);
    bestText = decoded;
  }
  return bestText;
}

function findColumnIndexByKeys(normalizedHeaders, keys) {
  for (const key of keys) {
    const idx = normalizedHeaders.findIndex((cell) => cell.includes(key));
    if (idx >= 0) return idx;
  }
  return -1;
}

function extractRowsBySchemaFromRows(rows, schema, options = {}) {
  const normalizeCell = options.normalizeCell;
  const normalizedRows = normalizeCell
    ? rows.map((row) => row.map((cell) => normalizeCell(cell)))
    : rows;
  const workingRows = options.skipFirstRow ? normalizedRows.slice(1) : normalizedRows;
  const best = pickBestHeaderRow(workingRows, schema);
  if (best.idx === -1 || best.missing > 0) {
    return { data: null, headerIndex: -1, score: best.score, missing: best.missing };
  }
  const headerRow = workingRows[best.idx].map((value) =>
    String(value || "").trim()
  );
  const normalized = headerRow.map(normalizeKey);
  const columnMap = new Map();
  schema.forEach((item) => {
    const idx = findColumnIndexByKeys(normalized, item.keys);
    if (idx >= 0) {
      columnMap.set(idx, item.name);
    }
  });
  const data = [];
  for (let i = best.idx + 1; i < workingRows.length; i += 1) {
    const row = workingRows[i];
    if (!row || isRowEmpty(row)) continue;
    const rowObject = {};
    columnMap.forEach((name, idx) => {
      rowObject[name] = row[idx];
    });
    data.push(rowObject);
  }
  return { data, headerIndex: best.idx, score: best.score, missing: 0 };
}

function extractRowsBySchemaFromSheet(sheet, schema, options = {}) {
  const rows = XLSXLib.utils.sheet_to_json(sheet, {
    header: 1,
    defval: ""
  });
  return extractRowsBySchemaFromRows(rows, schema, options);
}

function extractRowsBySchema(workbook, schema, options = {}) {
  let bestResult = null;
  workbook.SheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const result = extractRowsBySchemaFromSheet(sheet, schema, options);
    if (result.data && (!bestResult || result.score > bestResult.score)) {
      bestResult = result;
    }
  });
  if (!bestResult || !bestResult.data) {
    throw new Error(
      `Не удалось найти строку заголовков (${schema
        .map((item) => item.name)
        .join(", ")}).`
    );
  }
  return bestResult.data;
}

function normalizeSchema(schema) {
  return schema.map((item) => ({
    name: item.name,
    required: Boolean(item.required),
    keys: item.keys.concat([normalizeKey(item.name)])
  }));
}

function extractRowsByPositionsFromRows(rows, schema, fallback, options = {}) {
  const normalizeCell = options.normalizeCell;
  const normalizedRows = normalizeCell
    ? rows.map((row) => row.map((cell) => normalizeCell(cell)))
    : rows;
  const workingRows = options.skipFirstRow ? normalizedRows.slice(1) : normalizedRows;
  let startRow = fallback.startRow || 1;
  const headerScore = scoreHeaderRow(workingRows[startRow], schema);
  const requiredCount = schema.filter((item) => item.required).length;
  if (headerScore.matched >= requiredCount) {
    startRow += 1;
  }
  const data = [];
  for (let i = startRow; i < workingRows.length; i += 1) {
    const row = workingRows[i];
    if (!row || isRowEmpty(row)) continue;
    const rowObject = {};
    Object.entries(fallback.positions).forEach(([name, idx]) => {
      rowObject[name] = row[idx];
    });
    data.push(rowObject);
  }
  return data;
}

function extractRowsByPositionsFromSheet(sheet, schema, fallback, options = {}) {
  const rows = XLSXLib.utils.sheet_to_json(sheet, {
    header: 1,
    defval: ""
  });
  return extractRowsByPositionsFromRows(rows, schema, fallback, options);
}

function extractRowsBySchemaOrPositions(workbook, schema, fallback, options = {}) {
  try {
    return extractRowsBySchema(workbook, schema, options);
  } catch (error) {
    if (!fallback) throw error;
  }
  let bestData = null;
  workbook.SheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const data = extractRowsByPositionsFromSheet(sheet, schema, fallback, options);
    if (data.length > 0 && (!bestData || data.length > bestData.length)) {
      bestData = data;
    }
  });
  if (!bestData) {
    throw new Error(
      `Не удалось найти строку заголовков (${schema
        .map((item) => item.name)
        .join(", ")}).`
    );
  }
  return bestData;
}

function extractRowsBySchemaOrPositionsFromRows(rows, schema, fallback, options = {}) {
  try {
    const result = extractRowsBySchemaFromRows(rows, schema, options);
    if (result.data) return result.data;
  } catch (error) {
    if (!fallback) throw error;
  }
  if (!fallback) {
    throw new Error(
      `Не удалось найти строку заголовков (${schema
        .map((item) => item.name)
        .join(", ")}).`
    );
  }
  return extractRowsByPositionsFromRows(rows, schema, fallback, options);
}

async function readWorkbook(file, options = {}) {
  const name = String(file && file.name ? file.name : "").toLowerCase();
  if (name.endsWith(".csv")) {
    const text = await file.text();
    const commaCount = (text.match(/,/g) || []).length;
    const semicolonCount = (text.match(/;/g) || []).length;
    const delimiter = semicolonCount > commaCount ? ";" : ",";
    return XLSXLib.read(text, {
      type: "string",
      FS: delimiter,
      raw: true,
      cellDates: true,
      ...options
    });
  }
  const buffer = await file.arrayBuffer();
  return XLSXLib.read(buffer, { type: "array", cellDates: true, ...options });
}

function removeFirstRowFromWorkbook(workbook) {
  if (!workbook || !workbook.SheetNames) return workbook;
  const nextWorkbook = XLSXLib.utils.book_new();
  workbook.SheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return;
    const ref = sheet["!ref"];
    if (!ref) return;
    const range = XLSXLib.utils.decode_range(ref);
    const removeRow = range.s.r;
    const nextSheet = {};
    Object.keys(sheet).forEach((key) => {
      if (key[0] === "!") return;
      const cell = XLSXLib.utils.decode_cell(key);
      if (cell.r === removeRow) return;
      const target = { c: cell.c, r: cell.r > removeRow ? cell.r - 1 : cell.r };
      const targetKey = XLSXLib.utils.encode_cell(target);
      nextSheet[targetKey] = sheet[key];
    });
    const nextRange = {
      s: { c: range.s.c, r: range.s.r },
      e: { c: range.e.c, r: Math.max(range.s.r, range.e.r - 1) }
    };
    nextSheet["!ref"] = XLSXLib.utils.encode_range(nextRange);
    if (sheet["!cols"]) nextSheet["!cols"] = sheet["!cols"];
    if (sheet["!rows"]) nextSheet["!rows"] = sheet["!rows"];
    if (sheet["!merges"]) {
      const merges = [];
      sheet["!merges"].forEach((merge) => {
        if (merge.s.r <= removeRow && merge.e.r >= removeRow) {
          return;
        }
        if (merge.s.r > removeRow) {
          merges.push({
            s: { c: merge.s.c, r: merge.s.r - 1 },
            e: { c: merge.e.c, r: merge.e.r - 1 }
          });
          return;
        }
        merges.push(merge);
      });
      if (merges.length > 0) nextSheet["!merges"] = merges;
    }
    XLSXLib.utils.book_append_sheet(nextWorkbook, nextSheet, sheetName);
  });
  return nextWorkbook;
}

function extractRows(workbook, requiredHeaders) {
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSXLib.utils.sheet_to_json(sheet, {
    header: 1,
    defval: ""
  });
  const headerIndex = findHeaderRow(rows, requiredHeaders);
  if (headerIndex === -1) {
    throw new Error(
      `Не удалось найти строку заголовков (${requiredHeaders.join(", ")}).`
    );
  }
  const headers = rows[headerIndex].map((value) =>
    String(value || "").trim()
  );
  const data = [];
  for (let i = headerIndex + 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row || isRowEmpty(row)) continue;
    const rowObject = {};
    headers.forEach((header, index) => {
      rowObject[header] = row[index];
    });
    data.push(rowObject);
  }
  return data;
}
