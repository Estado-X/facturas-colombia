/* Arma un .xlsx real (Office Open XML) sin librerías: unas pocas partes XML dentro de un .zip.
   Los valores van como números y las fechas como fechas, para que Excel pueda sumar y filtrar. */
(function (raiz) {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function columna(i) { var s = ''; i++; while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
  // Texto dentro de una fórmula: solo códigos de moneda limpios; las comillas se doblan.
  function textoFormula(t) { return '"' + String(t).replace(/"/g, '""') + '"'; }
  function serial(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    if (!m) return null;
    return (Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(1899, 11, 30)) / 86400000;
  }

  // Estilos: 0 normal · 1 encabezado · 2 número · 3 fecha · 4 número en negrilla · 5 texto en negrilla · 6 texto literal (quotePrefix)
  var ESTILOS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy"/></numFmts>' +
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
    '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFF2EBDC"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="7">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="164" fontId="1" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" quotePrefix="1"/>' +
    '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

  function celda(ref, v, estilo) {
    if (v && typeof v === 'object' && v.f) {
      return '<c r="' + ref + '" s="' + (estilo || 0) + '"><f>' + esc(v.f) + '</f>' + (v.v != null ? '<v>' + v.v + '</v>' : '') + '</c>';
    }
    if (typeof v === 'number' && isFinite(v)) return '<c r="' + ref + '"' + (estilo ? ' s="' + estilo + '"' : '') + '><v>' + v + '</v></c>';
    if (v === null || v === undefined || v === '') return '';
    // Texto que empieza como fórmula: se marca como texto literal para que Excel nunca lo calcule.
    if (/^[=+\-@\t\r]/.test(String(v)) && !estilo) estilo = 6;
    return '<c r="' + ref + '" t="inlineStr"' + (estilo ? ' s="' + estilo + '"' : '') + '><is><t xml:space="preserve">' + esc(v) + '</t></is></c>';
  }

  /* filas: [[valor, ...]] · estilosCol: estilo por columna para las filas de datos
     anchos: ancho por columna · opciones: { encabezado: true, filtro: true, fijar: true, estilosFila: { i: [estilos] } } */
  function hoja(filas, anchos, estilosCol, op) {
    op = op || {};
    var x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">';
    if (op.fijar) x += '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>';
    x += '<cols>' + anchos.map(function (w, i) { return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>'; }).join('') + '</cols><sheetData>';
    filas.forEach(function (fila, r) {
      x += '<row r="' + (r + 1) + '">';
      fila.forEach(function (v, c) {
        var est = r === 0 && op.encabezado ? 1 : (op.estilosFila && op.estilosFila[r] ? op.estilosFila[r][c] : (estilosCol ? estilosCol[c] : 0));
        x += celda(columna(c) + (r + 1), v, est);
      });
      x += '</row>';
    });
    x += '</sheetData>';
    if (op.filtro) x += '<autoFilter ref="A1:' + columna(filas[0].length - 1) + op.filtro + '"/>';
    return x + '</worksheet>';
  }

  var COLUMNAS = [
    ['Tipo', 22], ['Prefijo', 9], ['Consecutivo', 13], ['Número', 16], ['Fecha de emisión', 15],
    ['Emisor', 34], ['Identificación del emisor', 16], ['DV', 5], ['Adquiriente', 34], ['Tipo de identificación del adquiriente', 14], ['Identificación del adquiriente', 18],
    ['Subtotal', 16], ['IVA', 14], ['Otros impuestos', 14], ['Detalle de otros impuestos', 18], ['Retenciones', 14], ['Total', 16],
    ['Moneda', 9], ['CUFE / CUDE', 40], ['Archivo', 34]
  ];
  // Índices de las columnas de plata (para totales): Subtotal, IVA, Otros, Retenciones, Total
  var PLATA = [11, 12, 13, 15, 16];
  var COL_MONEDA = 17;

  /* res: { documentos, errores, repetidas } (de Facturas.procesar) · totales: Facturas.totales(...) */
  function crear(res, totales, Zip, fechaZip) {
    Zip = Zip || raiz.Zip;
    var docs = res.documentos;
    var filas = [COLUMNAS.map(function (c) { return c[0]; })];
    docs.forEach(function (d) {
      var s = d.signo;
      filas.push([
        d.tipo, d.prefijo, d.consecutivo, d.numero, serial(d.fecha) == null ? d.fecha : serial(d.fecha),
        d.emisor.nombre, d.emisor.numero, d.emisor.dv, d.adquiriente.nombre, d.adquiriente.tipoIdTexto, d.adquiriente.numero,
        s * d.subtotal, s * d.iva, s * d.otros, d.otrosNombres, s * d.retenciones, s * d.total,
        d.moneda, d.cufe, d.archivo
      ]);
    });
    var ultima = docs.length + 1;
    var estilosFila = {};
    if (docs.length) {
      filas.push([]);
      totales.forEach(function (t) {
        var fila = new Array(COLUMNAS.length).fill('');
        fila[0] = 'Total ' + t.moneda + ' (' + t.n + (t.n === 1 ? ' documento)' : ' documentos)');
        var claves = ['subtotal', 'iva', 'otros', 'retenciones', 'total'];
        PLATA.forEach(function (c, k) {
          var L = columna(c), M = columna(COL_MONEDA);
          fila[c] = /^[A-Z]{3}$/.test(t.moneda)
            ? { f: 'SUMIF($' + M + '$2:$' + M + '$' + ultima + ',' + textoFormula(t.moneda) + ',' + L + '2:' + L + ultima + ')', v: t[claves[k]] }
            : t[claves[k]];
        });
        fila[COL_MONEDA] = t.moneda;
        estilosFila[filas.length] = fila.map(function (v, c) { return PLATA.indexOf(c) >= 0 ? 4 : 5; });
        filas.push(fila);
      });
    }
    var estilosCol = COLUMNAS.map(function (c, i) { return i === 4 ? 3 : (PLATA.indexOf(i) >= 0 ? 2 : 0); });
    var h1 = hoja(filas, COLUMNAS.map(function (c) { return c[1]; }), estilosCol,
      { encabezado: true, fijar: true, filtro: ultima, estilosFila: estilosFila });

    var av = [['Archivo', 'Qué pasó']];
    res.errores.forEach(function (e) { av.push([e.archivo, 'No se pudo leer: ' + e.motivo]); });
    res.repetidas.forEach(function (r) { av.push([r.archivo, 'Repetida: es la misma ' + (r.numero || 'factura') + ' de «' + r.igualA + '» (mismo CUFE/CUDE). No se sumó dos veces.']); });
    docs.forEach(function (d) { d.avisos.forEach(function (a) { av.push([d.archivo, a]); }); });
    if (av.length === 1) av.push(['', 'Sin avisos: se leyeron todos los archivos.']);
    var h2 = hoja(av, [44, 90], null, { encabezado: true });

    var archivos = [
      { nombre: '[Content_Types].xml', datos: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        '</Types>' },
      { nombre: '_rels/.rels', datos: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>' },
      { nombre: 'xl/workbook.xml', datos: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheets><sheet name="Facturas" sheetId="1" r:id="rId1"/><sheet name="Avisos" sheetId="2" r:id="rId2"/></sheets>' +
        (docs.length ? '<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">Facturas!$A$1:$' + columna(COLUMNAS.length - 1) + '$' + ultima + '</definedName></definedNames>' : '') +
        '</workbook>' },
      { nombre: 'xl/_rels/workbook.xml.rels', datos: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>' +
        '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        '</Relationships>' },
      { nombre: 'xl/worksheets/sheet1.xml', datos: h1 },
      { nombre: 'xl/worksheets/sheet2.xml', datos: h2 },
      { nombre: 'xl/styles.xml', datos: ESTILOS }
    ];
    return Zip.crear(archivos, fechaZip);
  }

  var Excel = { crear: crear, serial: serial, columna: columna, textoFormula: textoFormula, COLUMNAS: COLUMNAS };
  if (typeof module !== 'undefined' && module.exports) module.exports = Excel;
  else raiz.Excel = Excel;
})(this);
