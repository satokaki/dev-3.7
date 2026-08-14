import { jsPDF } from 'jspdf';

const COMPANY_NAME = 'IZZI JUICE COMPANY';

/**
 * Reusable tabular report PDF engine (jspdf, text-based, paginated).
 * Used by every report module so design changes live in one place.
 *
 * columns: [{ key, header, align?: 'left'|'right'|'center', width?: number }]
 * rows: array of plain objects (keys match columns)
 * meta: { company?, period?, printedBy? }
 */
export function exportReportToPDF({
  title,
  subtitle,
  columns,
  rows,
  fileName,
  meta = {},
}) {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'pt',
    format: 'a4',
  });

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 30;
  const usableW = pageW - margin * 2;
  const rowH = 16;

  const fmtDateTime = (d) => {
    const p = (n) => String(n).padStart(2, '0');

    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(
      d.getDate()
    )} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  const now = new Date();

  // Column widths: explicit width wins; remaining space split evenly among the rest.
  const specifiedSum = columns.reduce(
    (s, c) => s + (c.width || 0),
    0
  );

  const unspecCount = columns.filter(
    (c) => !c.width
  ).length;

  const autoW =
    unspecCount > 0
      ? (usableW - specifiedSum) / unspecCount
      : 0;

  const colW = columns.map(
    (c) => c.width || autoW
  );

  const alignOf = (c) =>
    c.align === 'right'
      ? 'right'
      : c.align === 'center'
        ? 'center'
        : 'left';

  const drawHeader = () => {
    let y = margin + 4;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(20, 20, 20);

    doc.text(
      meta.company || COMPANY_NAME,
      margin,
      y
    );

    y += 16;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(95, 95, 95);

    if (meta.period) {
      doc.text(
        `Periode: ${meta.period}`,
        margin,
        y
      );

      y += 12;
    }

    doc.text(
      `Dicetak: ${fmtDateTime(now)}`,
      margin,
      y
    );

    if (meta.printedBy) {
      doc.text(
        `Dicetak oleh: ${meta.printedBy}`,
        margin + 240,
        y
      );
    }

    y += 12;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(20, 20, 20);

    doc.text(
      title || 'Laporan',
      margin,
      y
    );

    y += 12;

    if (subtitle) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(95, 95, 95);

      doc.text(
        subtitle,
        margin,
        y
      );

      y += 12;
    }

    y += 4;

    doc.setDrawColor(205, 210, 215);
    doc.setLineWidth(0.8);

    doc.line(
      margin,
      y,
      pageW - margin,
      y
    );

    return y + 12;
  };

  const drawFooter = (page) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(135, 135, 135);

    doc.text(
      `${COMPANY_NAME} · ${fmtDateTime(now)}`,
      margin,
      pageH - 12
    );

    doc.text(
      `Halaman ${page}`,
      pageW - margin,
      pageH - 12,
      { align: 'right' }
    );
  };

  const drawTableHeader = (y) => {
    doc.setFillColor(235, 238, 242);
    doc.setTextColor(40, 40, 40);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);

    doc.rect(
      margin,
      y - 10,
      usableW,
      rowH,
      'F'
    );

    let x = margin;

    columns.forEach((c, i) => {
      const align = alignOf(c);

      const tx =
        align === 'right'
          ? x + colW[i] - 4
          : align === 'center'
            ? x + colW[i] / 2
            : x + 4;

      doc.text(
        String(c.header || ''),
        tx,
        y + 1,
        align === 'left'
          ? undefined
          : { align }
      );

      x += colW[i];
    });

    return y + rowH;
  };

  const drawRow = (row, y, shade) => {
    if (shade) {
      doc.setFillColor(248, 249, 251);

      doc.rect(
        margin,
        y - 10,
        usableW,
        rowH,
        'F'
      );
    }

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(40, 40, 40);

    let x = margin;

    columns.forEach((c, i) => {
      const val = row[c.key];

      const txt =
        val === null || val === undefined
          ? ''
          : String(val);

      const align = alignOf(c);

      const tx =
        align === 'right'
          ? x + colW[i] - 4
          : align === 'center'
            ? x + colW[i] / 2
            : x + 4;

      // Clamp text to column width (rough char cap)
      const max = Math.floor(
        colW[i] / 4.4
      );

      const out =
        txt.length > max
          ? txt.slice(0, max - 1) + '…'
          : txt;

      doc.text(
        out,
        tx,
        y + 1,
        align === 'left'
          ? undefined
          : { align }
      );

      x += colW[i];
    });

    return y + rowH;
  };

  let page = 1;
  let y = drawHeader();

  drawFooter(page);

  y = drawTableHeader(y);

  rows.forEach((row, ri) => {
    if (
      y >
      pageH - margin - 24
    ) {
      drawFooter(page);

      doc.addPage();

      page += 1;

      y = drawHeader();

      drawFooter(page);

      y = drawTableHeader(y);
    }

    y = drawRow(
      row,
      y,
      ri % 2 === 1
    );
  });

  doc.save(
    fileName || 'laporan.pdf'
  );
}

/**
 * Reusable transaction-document PDF engine (portrait A4).
 * Covers invoice, purchase order, production/bottling/labeling/excise orders,
 * payment receipt, stock adjustment — one template, configured per caller.
 *
 * opts:
 *  title, docNumber, docDate
 *  partyLabel, party: { name, address: [lines], phone? }
 *  meta: { company, companyAddress: [lines], printedAt? }
 *  infoLines: [{ label, value }]
 *  itemColumns: [{ key, header, align?, width? }]
 *  itemRows: [{...}]
 *  totals: [{ label, value, bold? }]
 *  notes
 *  signatures: [{ label, name }]
 *  fileName
 */
export function exportDocumentToPDF({
  title,
  docNumber,
  docDate,

  partyLabel = 'Kepada Yth.',
  party = {},

  meta = {},

  infoLines = [],

  itemColumns = [],
  itemRows = [],

  totals = [],

  notes = '',

  signatures = [],

  fileName = 'dokumen.pdf',
}) {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'a4',
  });

  const pageW =
    doc.internal.pageSize.getWidth();

  const pageH =
    doc.internal.pageSize.getHeight();

  const M = 40;
  const usableW = pageW - M * 2;
  const rowH = 16;

  const now = new Date();

  const p = (n) =>
    String(n).padStart(2, '0');

  const fmtDT = (d) =>
    `${d.getFullYear()}-${p(
      d.getMonth() + 1
    )}-${p(d.getDate())}`;

  const alignOf = (c) =>
    c.align === 'right'
      ? 'right'
      : c.align === 'center'
        ? 'center'
        : 'left';

  // ============================================================
  // COMPANY HEADER + DOCUMENT TITLE
  // ============================================================

  doc.setFont(
    'helvetica',
    'bold'
  );

  doc.setFontSize(14);

  doc.setTextColor(
    20,
    20,
    20
  );

  doc.text(
    meta.company || COMPANY_NAME,
    M,
    M + 4
  );

  let cy = M + 16;

  doc.setFont(
    'helvetica',
    'normal'
  );

  doc.setFontSize(9);

  doc.setTextColor(
    95,
    95,
    95
  );

  (
    meta.companyAddress || []
  ).forEach((line) => {
    doc.text(
      line,
      M,
      cy
    );

    cy += 11;
  });

  let ty = M;

  doc.setFont(
    'helvetica',
    'bold'
  );

  doc.setFontSize(16);

  doc.setTextColor(
    20,
    20,
    20
  );

  doc.text(
    String(
      title || 'DOKUMEN'
    ).toUpperCase(),
    pageW - M,
    ty + 4,
    {
      align: 'right',
    }
  );

  ty += 20;

  doc.setFont(
    'helvetica',
    'bold'
  );

  doc.setFontSize(11);

  doc.setTextColor(
    40,
    40,
    40
  );

  doc.text(
    docNumber || '',
    pageW - M,
    ty,
    {
      align: 'right',
    }
  );

  ty += 14;

  doc.setFont(
    'helvetica',
    'normal'
  );

  doc.setFontSize(9);

  doc.setTextColor(
    95,
    95,
    95
  );

  doc.text(
    `Tanggal: ${
      docDate || ''
    }`,
    pageW - M,
    ty,
    {
      align: 'right',
    }
  );

  ty += 12;

  if (meta.printedAt) {
    doc.text(
      `Dicetak: ${fmtDT(now)}`,
      pageW - M,
      ty,
      {
        align: 'right',
      }
    );

    ty += 12;
  }

  let y =
    Math.max(cy, ty) + 8;

  doc.setDrawColor(
    205,
    210,
    215
  );

  doc.setLineWidth(0.8);

  doc.line(
    M,
    y,
    pageW - M,
    y
  );

  y += 16;

  // ============================================================
  // PARTY + INFO
  // ============================================================

  const blockTop = y;

  let py = blockTop;

  doc.setFont(
    'helvetica',
    'bold'
  );

  doc.setFontSize(9);

  doc.setTextColor(
    120,
    120,
    120
  );

  doc.text(
    partyLabel,
    M,
    py
  );

  py += 13;

  doc.setFont(
    'helvetica',
    'bold'
  );

  doc.setFontSize(11);

  doc.setTextColor(
    20,
    20,
    20
  );

  doc.text(
    party.name || '-',
    M,
    py
  );

  py += 14;

  doc.setFont(
    'helvetica',
    'normal'
  );

  doc.setFontSize(9);

  doc.setTextColor(
    80,
    80,
    80
  );

  (
    party.address || []
  ).forEach((line) => {
    doc.text(
      line,
      M,
      py
    );

    py += 11;
  });

  if (party.phone) {
    doc.text(
      `Telp: ${party.phone}`,
      M,
      py
    );

    py += 11;
  }

  let iy = blockTop;

  doc.setFontSize(9);

  infoLines.forEach((il) => {
    doc.setFont(
      'helvetica',
      'normal'
    );

    doc.setTextColor(
      80,
      80,
      80
    );

    doc.text(
      il.label + ':',
      pageW - M - 180,
      iy
    );

    doc.setFont(
      'helvetica',
      'bold'
    );

    doc.setTextColor(
      20,
      20,
      20
    );

    doc.text(
      String(
        il.value ?? '-'
      ),
      pageW - M,
      iy,
      {
        align: 'right',
      }
    );

    iy += 13;
  });

  y =
    Math.max(py, iy) + 12;

  // ============================================================
  // ITEMS TABLE
  // ============================================================

  const specifiedSum =
    itemColumns.reduce(
      (s, c) =>
        s +
        (c.width || 0),
      0
    );

  const unspecCount =
    itemColumns.filter(
      (c) => !c.width
    ).length;

  const autoW =
    unspecCount > 0
      ? (
          usableW -
          specifiedSum
        ) /
        unspecCount
      : 0;

  const colW =
    itemColumns.map(
      (c) =>
        c.width ||
        autoW
    );

  const drawTableHeader = (
    yy
  ) => {
    doc.setFillColor(
      235,
      238,
      242
    );

    doc.setTextColor(
      40,
      40,
      40
    );

    doc.setFont(
      'helvetica',
      'bold'
    );

    doc.setFontSize(8.5);

    doc.rect(
      M,
      yy - 10,
      usableW,
      rowH,
      'F'
    );

    let x = M;

    itemColumns.forEach(
      (c, i) => {
        const align =
          alignOf(c);

        const tx =
          align === 'right'
            ? x +
              colW[i] -
              4
            : align ===
                'center'
              ? x +
                colW[i] /
                  2
              : x + 4;

        doc.text(
          String(
            c.header || ''
          ),
          tx,
          yy + 1,
          align === 'left'
            ? undefined
            : { align }
        );

        x += colW[i];
      }
    );

    return yy + rowH;
  };

  const drawItemRow = (
    row,
    yy,
    shade
  ) => {
    if (shade) {
      doc.setFillColor(
        248,
        249,
        251
      );

      doc.rect(
        M,
        yy - 10,
        usableW,
        rowH,
        'F'
      );
    }

    doc.setFont(
      'helvetica',
      'normal'
    );

    doc.setFontSize(8.5);

    doc.setTextColor(
      40,
      40,
      40
    );

    let x = M;

    itemColumns.forEach(
      (c, i) => {
        const val =
          row[c.key];

        const txt =
          val === null ||
          val ===
            undefined
            ? ''
            : String(val);

        const align =
          alignOf(c);

        const tx =
          align === 'right'
            ? x +
              colW[i] -
              4
            : align ===
                'center'
              ? x +
                colW[i] /
                  2
              : x + 4;

        const max =
          Math.floor(
            colW[i] /
              4.4
          );

        const out =
          txt.length > max
            ? txt.slice(
                0,
                max - 1
              ) + '…'
            : txt;

        doc.text(
          out,
          tx,
          yy + 1,
          align === 'left'
            ? undefined
            : { align }
        );

        x += colW[i];
      }
    );

    return yy + rowH;
  };

  const drawFooter = (
    page
  ) => {
    doc.setFont(
      'helvetica',
      'normal'
    );

    doc.setFontSize(8);

    doc.setTextColor(
      135,
      135,
      135
    );

    doc.text(
      `${COMPANY_NAME} · ${fmtDT(now)}`,
      M,
      pageH - 16
    );

    doc.text(
      `Halaman ${page}`,
      pageW - M,
      pageH - 16,
      {
        align: 'right',
      }
    );
  };

  let page = 1;

  drawFooter(page);

  y =
    drawTableHeader(y);

  itemRows.forEach(
    (row, ri) => {
      if (
        y >
        pageH - 130
      ) {
        drawFooter(page);

        doc.addPage();

        page += 1;

        drawFooter(page);

        y = M + 10;

        y =
          drawTableHeader(
            y
          );
      }

      y =
        drawItemRow(
          row,
          y,
          ri % 2 === 1
        );
    }
  );

  // ============================================================
  // TOTALS
  // ============================================================

  y += 6;

  const tboxX =
    pageW -
    M -
    240;

  totals.forEach((t) => {
    if (
      y >
      pageH - 90
    ) {
      drawFooter(page);

      doc.addPage();

      page += 1;

      drawFooter(page);

      y = M + 10;
    }

    doc.setFont(
      'helvetica',
      t.bold
        ? 'bold'
        : 'normal'
    );

    doc.setFontSize(
      t.bold
        ? 10.5
        : 9.5
    );

    doc.setTextColor(
      t.bold ? 20 : 80,
      t.bold ? 20 : 80,
      t.bold ? 20 : 80
    );

    doc.text(
      t.label,
      tboxX,
      y
    );

    doc.text(
      String(
        t.value ?? ''
      ),
      pageW - M,
      y,
      {
        align: 'right',
      }
    );

    y +=
      t.bold
        ? 16
        : 14;
  });

  // ============================================================
  // NOTES
  // ============================================================

  if (notes) {
    y += 6;

    doc.setFont(
      'helvetica',
      'bold'
    );

    doc.setFontSize(9);

    doc.setTextColor(
      120,
      120,
      120
    );

    doc.text(
      'Catatan:',
      M,
      y
    );

    y += 12;

    doc.setFont(
      'helvetica',
      'normal'
    );

    doc.setTextColor(
      80,
      80,
      80
    );

    const wrapped =
      doc.splitTextToSize(
        String(notes),
        usableW
      );

    doc.text(
      wrapped,
      M,
      y
    );

    y +=
      wrapped.length *
      11;
  }

  // ============================================================
  // SIGNATURES
  // ============================================================

  if (
    signatures.length >
    0
  ) {
    const sigY =
      Math.max(
        y + 30,
        pageH - 110
      );

    const col =
      usableW /
      signatures.length;

    signatures.forEach(
      (s, i) => {
        const sx =
          M +
          i * col;

        doc.setFont(
          'helvetica',
          'normal'
        );

        doc.setFontSize(9);

        doc.setTextColor(
          80,
          80,
          80
        );

        doc.text(
          s.label,
          sx,
          sigY
        );

        doc.setDrawColor(
          150,
          150,
          150
        );

        doc.setLineWidth(
          0.6
        );

        doc.line(
          sx,
          sigY + 50,
          sx + 150,
          sigY + 50
        );

        doc.setFont(
          'helvetica',
          'bold'
        );

        doc.setTextColor(
          20,
          20,
          20
        );

        doc.text(
          s.name || '',
          sx,
          sigY + 62
        );
      }
    );
  }

  doc.save(fileName);
}