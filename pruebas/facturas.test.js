// Pruebas sin dependencias: node --test pruebas/
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Z = require('../assets/zip.js');
const F = require('../assets/facturas.js');
const X = require('../assets/excel.js');

const EJ = path.join(__dirname, '..', 'ejemplos');
const leer = (n) => ({ nombre: n, bytes: new Uint8Array(fs.readFileSync(path.join(EJ, n))) });
const texto = (n) => fs.readFileSync(path.join(EJ, n), 'utf8');
const enc = new TextEncoder();

async function deflate(bytes) {
  const s = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

test('los ejemplos dicen que son ficticios', () => {
  for (const n of fs.readdirSync(EJ).filter((x) => x.endsWith('.xml'))) {
    assert.match(texto(n), /EJEMPLO FICTICIO/, n);
  }
});

test('factura UBL: número, prefijo, fecha, emisor con DV, adquiriente, IVA, retención y CUFE', () => {
  const r = F.leerDocumento(texto('FEPR1001_papeleria_ficticia.xml'));
  assert.ok(r.ok);
  const d = r.doc;
  assert.strictEqual(d.tipo, 'Factura');
  assert.strictEqual(d.numero, 'FEPR1001');
  assert.strictEqual(d.prefijo, 'FEPR');
  assert.strictEqual(d.consecutivo, '1001');
  assert.strictEqual(F.fecha(d.fecha), '03/11/2026');
  assert.strictEqual(d.emisor.nombre, 'Papelería Ficticia de Ejemplo S.A.S.');
  assert.strictEqual(d.emisor.idTexto, 'NIT 900000001-2');
  assert.strictEqual(d.adquiriente.idTexto, 'CC 1000000001');
  assert.strictEqual(d.subtotal, 1250000);
  assert.strictEqual(d.iva, 237500); // solo el TaxTotal del documento, no el de la línea
  assert.strictEqual(d.otros, 0);
  assert.strictEqual(d.retenciones, 31250);
  assert.strictEqual(d.total, 1487500);
  assert.strictEqual(d.moneda, 'COP');
  assert.strictEqual(d.cufe.length, 96);
  assert.strictEqual(d.esquemaCufe, 'CUFE-SHA384');
});

test('contenedor AttachedDocument: lee la factura del CDATA y no el ApplicationResponse', () => {
  const r = F.leerDocumento(texto('FEPR1001_reenviada_ficticia.xml'));
  assert.ok(r.ok);
  assert.strictEqual(r.contenedor, true);
  assert.strictEqual(r.doc.numero, 'FEPR1001');
  assert.strictEqual(r.doc.total, 1487500);
});

test('contenedor con la factura escapada (sin CDATA) también se lee', () => {
  const interna = texto('FEPR1001_papeleria_ficticia.xml');
  const esc = interna.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const ad = '<AttachedDocument xmlns:cac="a" xmlns:cbc="b"><cac:Attachment><cac:ExternalReference><cbc:Description>' + esc +
    '</cbc:Description></cac:ExternalReference></cac:Attachment></AttachedDocument>';
  const r = F.leerDocumento(ad);
  assert.ok(r.ok);
  assert.strictEqual(r.doc.numero, 'FEPR1001');
});

test('nota crédito: CUDE, resta en los totales', () => {
  const d = F.leerDocumento(texto('NCPR15_nota_credito_ficticia.xml')).doc;
  assert.strictEqual(d.tipo, 'Nota crédito');
  assert.strictEqual(d.signo, -1);
  assert.strictEqual(d.esquemaCufe, 'CUDE-SHA384');
  const f = F.leerDocumento(texto('FEPR1001_papeleria_ficticia.xml')).doc;
  const t = F.totales([f, d]);
  assert.strictEqual(t.length, 1);
  assert.strictEqual(t[0].total, 1487500 - 297500);
  assert.strictEqual(t[0].iva, 237500 - 47500);
});

test('nota débito: totales en RequestedMonetaryTotal', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<DebitNote xmlns="urn:oasis:names:specification:ubl:schema:xsd:DebitNote-2" xmlns:cac="c" xmlns:cbc="b">
  <cbc:ID>NDPR3</cbc:ID><cbc:UUID schemeName="CUDE-SHA384">abc123</cbc:UUID><cbc:IssueDate>2026-12-01</cbc:IssueDate>
  <cbc:DocumentCurrencyCode>COP</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty><cac:Party><cac:PartyTaxScheme><cbc:RegistrationName>Empresa Ficticia</cbc:RegistrationName><cbc:CompanyID schemeID="5" schemeName="31">900000009</cbc:CompanyID></cac:PartyTaxScheme></cac:Party></cac:AccountingSupplierParty>
  <cac:TaxTotal><cbc:TaxAmount>1900.00</cbc:TaxAmount><cac:TaxSubtotal><cac:TaxCategory><cac:TaxScheme><cbc:ID>01</cbc:ID><cbc:Name>IVA</cbc:Name></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal></cac:TaxTotal>
  <cac:RequestedMonetaryTotal><cbc:LineExtensionAmount>10000.00</cbc:LineExtensionAmount><cbc:PayableAmount>11900.00</cbc:PayableAmount></cac:RequestedMonetaryTotal>
</DebitNote>`;
  const d = F.leerDocumento(xml).doc;
  assert.strictEqual(d.tipo, 'Nota débito');
  assert.strictEqual(d.signo, 1);
  assert.strictEqual(d.total, 11900);
  assert.strictEqual(d.iva, 1900);
  assert.strictEqual(d.emisor.idTexto, 'NIT 900000009-5');
  assert.strictEqual(d.prefijo, 'NDPR');
  assert.strictEqual(d.consecutivo, '3');
});

test('otros impuestos (INC) no se suman al IVA', async () => {
  const r = await F.procesar([leer('RFP2045_restaurante_ficticio.zip')], null, Z);
  assert.strictEqual(r.documentos.length, 1);
  const d = r.documentos[0];
  assert.strictEqual(d.iva, 0);
  assert.strictEqual(d.otros, 14800);
  assert.strictEqual(d.otrosNombres, 'INC');
  assert.strictEqual(d.total, 199800);
  assert.match(d.archivo, /RFP2045_restaurante_ficticio\.zip › .*\.xml$/);
});

test('factura de exportación en dólares: totales separados por moneda', async () => {
  const r = await F.procesar(['FEPR1001_papeleria_ficticia.xml', 'FEX12_exportacion_ficticia.xml'].map(leer), null, Z);
  const t = F.totales(r.documentos);
  assert.deepStrictEqual(t.map((x) => x.moneda), ['COP', 'USD']);
  assert.strictEqual(t[1].total, 800);
  assert.strictEqual(r.documentos.find((d) => d.moneda === 'USD').tipo, 'Factura de exportación');
});

test('todos los ejemplos: 4 documentos, 1 repetida por CUFE, sin errores, en orden de fecha', async () => {
  const r = await F.procesar(fs.readdirSync(EJ).map(leer), null, Z);
  assert.strictEqual(r.documentos.length, 4);
  assert.strictEqual(r.errores.length, 0);
  assert.strictEqual(r.repetidas.length, 1);
  assert.strictEqual(r.repetidas[0].numero, 'FEPR1001');
  assert.deepStrictEqual(r.documentos.map((d) => d.fecha), ['2026-11-03', '2026-11-10', '2026-11-14', '2026-11-20']);
  const cop = F.totales(r.documentos)[0];
  assert.strictEqual(cop.total, 1487500 - 297500 + 199800);
});

test('volver a cargar lo mismo no duplica', async () => {
  const r1 = await F.procesar([leer('FEPR1001_papeleria_ficticia.xml')], null, Z);
  const r2 = await F.procesar([leer('FEPR1001_papeleria_ficticia.xml')], r1, Z);
  assert.strictEqual(r2.documentos.length, 1);
  assert.strictEqual(r2.repetidas.length, 1);
});

test('avisa lo que no puede leer', async () => {
  const malos = [
    { nombre: 'roto.xml', bytes: enc.encode('<Invoice><cbc:ID>1</Invoice>') },
    { nombre: 'evento.xml', bytes: enc.encode('<ApplicationResponse><ID>1</ID></ApplicationResponse>') },
    { nombre: 'otro.xml', bytes: enc.encode('<Pedido><ID>1</ID></Pedido>') },
    { nombre: 'factura.pdf', bytes: enc.encode('%PDF-1.4 ficticio') },
    { nombre: 'solo-pdf.zip', bytes: Z.crear([{ nombre: 'factura.pdf', datos: '%PDF' }]) },
    { nombre: 'danado.zip', bytes: new Uint8Array([0x50, 0x4B, 3, 4, 1, 2, 3]) }
  ];
  const r = await F.procesar(malos, null, Z);
  assert.strictEqual(r.documentos.length, 0);
  assert.strictEqual(r.errores.length, 6);
  const m = Object.fromEntries(r.errores.map((e) => [e.archivo, e.motivo]));
  assert.match(m['roto.xml'], /No es un XML válido/);
  assert.match(m['evento.xml'], /ApplicationResponse/);
  assert.match(m['otro.xml'], /Pedido/);
  assert.match(m['factura.pdf'], /Solo se leen/);
  assert.match(m['solo-pdf.zip'], /no trae ningún \.xml/);
  assert.match(m['danado.zip'], /dañado/);
});

test('XML en ISO-8859-1 respeta las tildes', () => {
  const s = '<?xml version="1.0" encoding="ISO-8859-1"?><Invoice xmlns:cac="c" xmlns:cbc="b"><cbc:ID>A1</cbc:ID>' +
    '<cac:AccountingSupplierParty><cac:Party><cac:PartyTaxScheme><cbc:RegistrationName>Panadería Ñapa</cbc:RegistrationName></cac:PartyTaxScheme></cac:Party></cac:AccountingSupplierParty>' +
    '<cac:LegalMonetaryTotal><cbc:PayableAmount>100.00</cbc:PayableAmount></cac:LegalMonetaryTotal></Invoice>';
  const bytes = Uint8Array.from(s, (c) => c.charCodeAt(0)); // latin1
  const d = F.leerDocumento(F.decodificar(bytes)).doc;
  assert.strictEqual(d.emisor.nombre, 'Panadería Ñapa');
  assert.ok(d.avisos.some((a) => /CUFE/.test(a)));
});

test('documento del ambiente de pruebas lleva aviso', () => {
  const s = texto('FEPR1001_papeleria_ficticia.xml').replace('<cbc:ProfileExecutionID>1<', '<cbc:ProfileExecutionID>2<');
  const d = F.leerDocumento(s).doc;
  assert.ok(d.avisos.some((a) => /ambiente de pruebas/.test(a)));
});

test('zip: lee archivos comprimidos con deflate y guardados sin comprimir', async () => {
  const contenido = enc.encode('<x>' + 'factura '.repeat(500) + '</x>');
  const def = await deflate(contenido);
  // zip armado a mano con una entrada deflate (método 8)
  const plano = Z.crear([{ nombre: 'a.xml', datos: contenido }]);
  const lista = Z.listar(plano);
  assert.strictEqual(lista.length, 1);
  assert.deepStrictEqual(await lista[0].leer(), contenido);
  // reemplazar la entrada por la versión comprimida
  const nombre = enc.encode('a.xml');
  const cab = new Uint8Array(30 + nombre.length);
  const v = new DataView(cab.buffer);
  v.setUint32(0, 0x04034B50, true); v.setUint16(8, 8, true); v.setUint32(14, Z.crc32(contenido), true);
  v.setUint32(18, def.length, true); v.setUint32(22, contenido.length, true); v.setUint16(26, nombre.length, true);
  cab.set(nombre, 30);
  const cen = new Uint8Array(46 + nombre.length);
  const w = new DataView(cen.buffer);
  w.setUint32(0, 0x02014B50, true); w.setUint16(10, 8, true); w.setUint32(16, Z.crc32(contenido), true);
  w.setUint32(20, def.length, true); w.setUint32(24, contenido.length, true); w.setUint16(28, nombre.length, true);
  cen.set(nombre, 46);
  const fin = new Uint8Array(22);
  const x = new DataView(fin.buffer);
  x.setUint32(0, 0x06054B50, true); x.setUint16(8, 1, true); x.setUint16(10, 1, true);
  x.setUint32(12, cen.length, true); x.setUint32(16, cab.length + def.length, true);
  const zip = new Uint8Array([...cab, ...def, ...cen, ...fin]);
  const l2 = Z.listar(zip);
  assert.strictEqual(l2[0].metodo, 8);
  assert.deepStrictEqual(await l2[0].leer(), contenido);
});

test('el zip de ejemplo (hecho con otra herramienta) viene comprimido y se abre', async () => {
  const l = Z.listar(leer('RFP2045_restaurante_ficticio.zip').bytes);
  assert.ok(l.some((e) => e.metodo === 8));
});

test('crc32 conocido', () => {
  assert.strictEqual(Z.crc32(enc.encode('123456789')), 0xCBF43926);
});

test('formato para la gente: pesos y fechas', () => {
  assert.strictEqual(F.pesos(1487500), '1.487.500,00');
  assert.strictEqual(F.pesos(-297500.5), '−297.500,50');
  assert.strictEqual(F.pesos(0), '0,00');
  assert.strictEqual(F.fecha('2026-12-08'), '08/12/2026');
});

test('Excel: .xlsx válido con números como números, fechas como fechas y totales por moneda', async () => {
  const r = await F.procesar(fs.readdirSync(EJ).map(leer), null, Z);
  const xlsx = X.crear(r, F.totales(r.documentos), Z, new Date(2026, 11, 8));
  const partes = {};
  for (const e of Z.listar(xlsx)) partes[e.nombre] = new TextDecoder().decode(await e.leer());
  for (const p of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml', 'xl/styles.xml']) {
    assert.ok(partes[p], 'falta ' + p);
    F.leerXml(partes[p]); // XML bien formado
  }
  const h = partes['xl/worksheets/sheet1.xml'];
  // Fila 2 = factura del 3 nov 2026: fecha como serial de Excel (46329) y total como número
  assert.strictEqual(X.serial('2026-11-03'), 46329);
  assert.match(h, /<c r="E2" s="3"><v>46329<\/v><\/c>/);
  assert.match(h, /<c r="Q2" s="2"><v>1487500<\/v><\/c>/);
  // Nota crédito en negativo
  assert.match(h, /<c r="Q3" s="2"><v>-297500<\/v><\/c>/);
  // Totales con SUMIF por moneda y el valor ya calculado
  assert.match(h, /SUMIF\(\$R\$2:\$R\$5,&quot;COP&quot;,Q2:Q5\)<\/f><v>1389800<\/v>/);
  assert.match(h, /SUMIF\(\$R\$2:\$R\$5,&quot;USD&quot;,Q2:Q5\)<\/f><v>800<\/v>/);
  // NIT como texto (no pierde ceros) y avisos en la segunda hoja
  assert.match(h, /<c r="G2" t="inlineStr"><is><t xml:space="preserve">900000001<\/t>/);
  assert.match(partes['xl/worksheets/sheet2.xml'], /Repetida/);
});

test('Excel sin documentos también abre', () => {
  const xlsx = X.crear({ documentos: [], errores: [], repetidas: [] }, [], Z);
  assert.ok(Z.esZip(xlsx));
});
