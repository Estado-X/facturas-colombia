/* Lee facturas electrónicas de la DIAN (XML UBL 2.1, Anexo Técnico de Factura Electrónica
   de Venta, versión 1.9) y saca los datos para la tabla.
   Entiende: Invoice (factura), CreditNote (nota crédito), DebitNote (nota débito) y el
   AttachedDocument (contenedor que llega al correo, con la factura adentro como texto).
   Trae su propio lector de XML para funcionar igual en el navegador y en las pruebas. */
(function (raiz) {
  'use strict';

  /* ---------- Lector de XML mínimo (no expande entidades externas ni DOCTYPE) ---------- */

  var ENT = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
  function entidades(s) {
    if (s.indexOf('&') < 0) return s;
    return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, function (m, e) {
      if (e[0] === '#') {
        var n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        try { return String.fromCodePoint(n); } catch (x) { return m; }
      }
      return Object.prototype.hasOwnProperty.call(ENT, e) ? ENT[e] : m;
    });
  }
  function local(q) { var i = q.indexOf(':'); return i < 0 ? q : q.slice(i + 1); }

  function leerXml(s) {
    if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
    var i = 0, n = s.length, pila = [], raizNodo = null;
    var reAttr = /([^\s=\/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
    function textoA(t) {
      if (pila.length) pila[pila.length - 1].t += t;
      else if (/\S/.test(t)) throw new Error('Texto fuera del elemento raíz.');
    }
    while (i < n) {
      var lt = s.indexOf('<', i);
      if (lt < 0) { textoA(entidades(s.slice(i))); break; }
      if (lt > i) textoA(entidades(s.slice(i, lt)));
      if (s.startsWith('<!--', lt)) { var c = s.indexOf('-->', lt + 4); if (c < 0) throw new Error('Comentario sin cerrar.'); i = c + 3; continue; }
      if (s.startsWith('<![CDATA[', lt)) { var d = s.indexOf(']]>', lt + 9); if (d < 0) throw new Error('CDATA sin cerrar.'); textoA(s.slice(lt + 9, d)); i = d + 3; continue; }
      if (s.startsWith('<?', lt)) { var q = s.indexOf('?>', lt + 2); if (q < 0) throw new Error('Declaración sin cerrar.'); i = q + 2; continue; }
      if (s.startsWith('<!', lt)) { var g = s.indexOf('>', lt + 2); if (g < 0) throw new Error('Declaración sin cerrar.'); i = g + 1; continue; }
      var gt = buscarCierre(s, lt + 1);
      if (gt < 0) throw new Error('Etiqueta sin cerrar.');
      var cuerpo = s.slice(lt + 1, gt);
      i = gt + 1;
      if (cuerpo[0] === '/') {
        var nomFin = cuerpo.slice(1).trim();
        var abierto = pila.pop();
        if (!abierto || abierto.q !== nomFin) throw new Error('Etiquetas mal cerradas cerca de </' + nomFin + '>.');
        continue;
      }
      var auto = cuerpo[cuerpo.length - 1] === '/';
      if (auto) cuerpo = cuerpo.slice(0, -1);
      var m = /^([^\s\/>]+)/.exec(cuerpo);
      if (!m) throw new Error('Etiqueta vacía.');
      var nodo = { q: m[1], n: local(m[1]), a: {}, c: [], t: '' };
      reAttr.lastIndex = m[1].length;
      var at;
      while ((at = reAttr.exec(cuerpo))) nodo.a[local(at[1])] = entidades(at[3] !== undefined ? at[3] : at[4]);
      if (pila.length) pila[pila.length - 1].c.push(nodo);
      else if (raizNodo) throw new Error('El XML tiene más de un elemento raíz.');
      else raizNodo = nodo;
      if (!auto) pila.push(nodo);
    }
    if (pila.length) throw new Error('El XML está incompleto: falta cerrar <' + pila[pila.length - 1].q + '>.');
    if (!raizNodo) throw new Error('El archivo no tiene contenido XML.');
    return raizNodo;
  }
  function buscarCierre(s, desde) {
    var comilla = null;
    for (var k = desde; k < s.length; k++) {
      var ch = s[k];
      if (comilla) { if (ch === comilla) comilla = null; }
      else if (ch === '"' || ch === "'") comilla = ch;
      else if (ch === '>') return k;
    }
    return -1;
  }

  function hijo(nodo, nombre) {
    if (!nodo) return null;
    for (var i = 0; i < nodo.c.length; i++) if (nodo.c[i].n === nombre) return nodo.c[i];
    return null;
  }
  function hijos(nodo, nombre) { return nodo ? nodo.c.filter(function (h) { return h.n === nombre; }) : []; }
  function ruta(nodo, camino) {
    var partes = camino.split('/');
    for (var i = 0; i < partes.length && nodo; i++) nodo = hijo(nodo, partes[i]);
    return nodo;
  }
  function texto(nodo) { return nodo ? nodo.t.trim() : ''; }
  function buscar(nodo, nombre) {
    if (!nodo) return null;
    if (nodo.n === nombre) return nodo;
    for (var i = 0; i < nodo.c.length; i++) { var r = buscar(nodo.c[i], nombre); if (r) return r; }
    return null;
  }

  /* ---------- Bytes → texto, respetando la codificación declarada ---------- */

  function decodificar(bytes) {
    if (bytes[0] === 0xFF && bytes[1] === 0xFE) return new TextDecoder('utf-16le').decode(bytes);
    if (bytes[0] === 0xFE && bytes[1] === 0xFF) return new TextDecoder('utf-16be').decode(bytes);
    var cabeza = new TextDecoder('latin1').decode(bytes.subarray(0, 200));
    var m = /encoding\s*=\s*["']([A-Za-z0-9._-]+)["']/.exec(cabeza);
    var cod = m ? m[1].toLowerCase() : 'utf-8';
    try { return new TextDecoder(cod).decode(bytes); }
    catch (e) { return new TextDecoder('utf-8').decode(bytes); }
  }

  /* ---------- Factura electrónica → fila ---------- */

  // Tipo de documento de identificación (Anexo 1.9, tabla 13.2.1; @schemeName).
  var TIPOS_ID = { '11': 'Registro civil', '12': 'TI', '13': 'CC', '21': 'Tarjeta de extranjería', '22': 'CE', '31': 'NIT', '41': 'Pasaporte', '42': 'Doc. extranjero', '47': 'PEP', '48': 'PPT', '50': 'NIT de otro país', '91': 'NUIP' };
  var RAICES = { Invoice: 1, CreditNote: 1, DebitNote: 1 };

  function num(nodo) {
    var t = texto(nodo);
    if (!t) return null;
    var v = Number(t);
    return isFinite(v) ? v : null;
  }
  function r2(v) { return Math.round(v * 100) / 100; }

  function parte(nodoParte) {
    var p = hijo(nodoParte, 'Party');
    var nombre = texto(ruta(p, 'PartyTaxScheme/RegistrationName')) || texto(ruta(p, 'PartyLegalEntity/RegistrationName')) ||
      texto(ruta(p, 'PartyName/Name'));
    if (!nombre) {
      var per = hijo(p, 'Person');
      if (per) nombre = [texto(hijo(per, 'FirstName')), texto(hijo(per, 'MiddleName')), texto(hijo(per, 'FamilyName'))].filter(Boolean).join(' ');
    }
    var idNodo = ruta(p, 'PartyTaxScheme/CompanyID') || ruta(p, 'PartyLegalEntity/CompanyID') || ruta(p, 'PartyIdentification/ID');
    var numero = texto(idNodo);
    var tipo = idNodo ? (idNodo.a.schemeName || '') : '';
    var dv = idNodo && tipo === '31' ? (idNodo.a.schemeID || '') : '';
    var etiqueta = TIPOS_ID[tipo] || (tipo ? 'Doc. ' + tipo : '');
    var mostrar = numero ? ((etiqueta ? etiqueta + ' ' : '') + numero + (dv ? '-' + dv : '')) : '';
    return { nombre: nombre, numero: numero, dv: dv, tipoId: tipo, tipoIdTexto: etiqueta, idTexto: mostrar };
  }

  function tipoDocumento(raizNodo) {
    if (raizNodo.n === 'CreditNote') return { tipo: 'Nota crédito', signo: -1 };
    if (raizNodo.n === 'DebitNote') return { tipo: 'Nota débito', signo: 1 };
    var cod = texto(hijo(raizNodo, 'InvoiceTypeCode'));
    if (cod === '02') return { tipo: 'Factura de exportación', signo: 1 };
    if (cod === '03' || cod === '04') return { tipo: 'Factura de contingencia', signo: 1 };
    return { tipo: 'Factura', signo: 1 };
  }

  function extraer(raizNodo) {
    var t = tipoDocumento(raizNodo);
    var avisos = [];
    var numero = texto(hijo(raizNodo, 'ID'));
    var prefNodo = buscar(hijo(raizNodo, 'UBLExtensions'), 'Prefix');
    var prefijo = texto(prefNodo), consecutivo = numero;
    if (prefijo && numero.indexOf(prefijo) === 0) consecutivo = numero.slice(prefijo.length).replace(/^-/, '');
    else {
      var m = /^([A-Za-z]+)-?(\d+)$/.exec(numero);
      if (m) { prefijo = m[1]; consecutivo = m[2]; } else prefijo = '';
    }
    var emisor = parte(hijo(raizNodo, 'AccountingSupplierParty'));
    var adq = parte(hijo(raizNodo, 'AccountingCustomerParty'));
    var tot = hijo(raizNodo, 'LegalMonetaryTotal') || hijo(raizNodo, 'RequestedMonetaryTotal');
    var subtotal = num(hijo(tot, 'LineExtensionAmount'));
    var total = num(hijo(tot, 'PayableAmount'));
    if (total === null) avisos.push('No trae el total a pagar (PayableAmount).');
    var iva = 0, otros = 0, nombresOtros = [];
    hijos(raizNodo, 'TaxTotal').forEach(function (tt) {
      var monto = num(hijo(tt, 'TaxAmount')) || 0;
      var esquema = ruta(tt, 'TaxSubtotal/TaxCategory/TaxScheme');
      var id = texto(hijo(esquema, 'ID'));
      if (id === '01') iva += monto;
      else {
        otros += monto;
        var nom = texto(hijo(esquema, 'Name')) || ('Tributo ' + id);
        if (nombresOtros.indexOf(nom) < 0) nombresOtros.push(nom);
      }
    });
    var retenciones = 0;
    hijos(raizNodo, 'WithholdingTaxTotal').forEach(function (tt) { retenciones += num(hijo(tt, 'TaxAmount')) || 0; });
    var uuid = hijo(raizNodo, 'UUID');
    var moneda = texto(hijo(raizNodo, 'DocumentCurrencyCode')) || (hijo(tot, 'PayableAmount') ? (hijo(tot, 'PayableAmount').a.currencyID || '') : '') || 'COP';
    // Solo códigos ISO 4217 (tres letras). Lo demás no entra a la tabla ni a las fórmulas del Excel.
    if (!/^[A-Z]{3}$/.test(moneda)) { avisos.push('La moneda no es un código válido de tres letras; se dejó como «¿?».'); moneda = '¿?'; }
    if (texto(hijo(raizNodo, 'ProfileExecutionID')) === '2') avisos.push('Es un documento del ambiente de pruebas de la DIAN, no una factura real.');
    if (!uuid || !texto(uuid)) avisos.push('No trae CUFE ni CUDE.');
    return {
      tipo: t.tipo, signo: t.signo, raiz: raizNodo.n,
      numero: numero, prefijo: prefijo, consecutivo: consecutivo,
      fecha: texto(hijo(raizNodo, 'IssueDate')),
      emisor: emisor, adquiriente: adq,
      subtotal: subtotal === null ? 0 : r2(subtotal), iva: r2(iva), otros: r2(otros), otrosNombres: nombresOtros.join(', '),
      retenciones: r2(retenciones), total: total === null ? 0 : r2(total), moneda: moneda,
      cufe: texto(uuid), esquemaCufe: uuid ? (uuid.a.schemeName || '') : '',
      avisos: avisos
    };
  }

  /* Texto XML → { ok, doc } o { ok: false, motivo }. */
  function leerDocumento(xmlTexto) {
    var r;
    try { r = leerXml(xmlTexto); }
    catch (e) { return { ok: false, motivo: 'No es un XML válido: ' + e.message }; }
    if (RAICES[r.n]) return { ok: true, doc: extraer(r), contenedor: false };
    if (r.n === 'AttachedDocument') {
      var desc = ruta(r, 'Attachment/ExternalReference/Description');
      var candidatos = desc ? [desc] : [];
      // Respaldo: cualquier Description que traiga un documento adentro.
      (function todos(nodo) {
        nodo.c.forEach(function (h) { if (h.n === 'Description' && h !== desc) candidatos.push(h); todos(h); });
      })(r);
      for (var i = 0; i < candidatos.length; i++) {
        var adentro = texto(candidatos[i]);
        if (adentro.indexOf('<') < 0) continue;
        try {
          var x = leerXml(adentro);
          if (RAICES[x.n]) return { ok: true, doc: extraer(x), contenedor: true };
        } catch (e) { /* sigue con el siguiente */ }
      }
      return { ok: false, motivo: 'Es un contenedor (AttachedDocument), pero no trae adentro una factura ni una nota legible.' };
    }
    if (r.n === 'ApplicationResponse') return { ok: false, motivo: 'Es una respuesta o evento de la DIAN (ApplicationResponse), no una factura.' };
    return { ok: false, motivo: 'No es una factura electrónica de la DIAN (el documento es «' + r.n + '»).' };
  }

  /* ---------- Varios archivos: abrir zip, leer, quitar repetidas ---------- */

  function llave(doc) {
    if (doc.cufe) return 'c:' + doc.cufe.toLowerCase();
    return 'n:' + doc.raiz + '|' + doc.emisor.numero + '|' + doc.numero;
  }

  /* archivos: [{ nombre, bytes: Uint8Array }]. estado (opcional): resultado anterior, para sumar.
     Devuelve una promesa con { documentos, errores, repetidas }. */
  function procesar(archivos, estado, Zip) {
    Zip = Zip || raiz.Zip;
    var res = estado || { documentos: [], errores: [], repetidas: [] };
    var vistos = {};
    res.documentos.forEach(function (d) { vistos[llave(d)] = d.archivo; });

    function agregarXml(nombre, bytes) {
      var r = leerDocumento(decodificar(bytes));
      if (!r.ok) { res.errores.push({ archivo: nombre, motivo: r.motivo }); return; }
      var d = r.doc;
      d.archivo = nombre;
      var k = llave(d);
      if (vistos[k]) { res.repetidas.push({ archivo: nombre, igualA: vistos[k], numero: d.numero, cufe: d.cufe }); return; }
      vistos[k] = nombre;
      res.documentos.push(d);
    }

    function abrirZip(nombre, bytes, nivel) {
      var lista;
      try { lista = Zip.listar(bytes); }
      catch (e) { res.errores.push({ archivo: nombre, motivo: e.message }); return Promise.resolve(); }
      var utiles = lista.filter(function (e) { return /\.(xml|zip)$/i.test(e.nombre) && !/(^|\/)__MACOSX\//.test(e.nombre); });
      if (!utiles.length) {
        res.errores.push({ archivo: nombre, motivo: 'El .zip no trae ningún .xml (solo trae ' + (lista.length ? lista.map(function (e) { return e.nombre; }).join(', ') : 'nada') + ').' });
        return Promise.resolve();
      }
      return utiles.reduce(function (p, e) {
        return p.then(function () {
          var etiqueta = nombre + ' › ' + e.nombre;
          return e.leer().then(function (b) {
            if (/\.zip$/i.test(e.nombre)) {
              if (nivel >= 2) { res.errores.push({ archivo: etiqueta, motivo: 'Hay demasiados .zip uno dentro de otro.' }); return; }
              return abrirZip(etiqueta, b, nivel + 1);
            }
            agregarXml(etiqueta, b);
          }, function (err) { res.errores.push({ archivo: etiqueta, motivo: err.message }); });
        });
      }, Promise.resolve());
    }

    return archivos.reduce(function (p, a) {
      return p.then(function () {
        var b = a.bytes instanceof Uint8Array ? a.bytes : new Uint8Array(a.bytes);
        if (Zip.esZip(b)) return abrirZip(a.nombre, b, 0);
        var cab = new TextDecoder('latin1').decode(b.subarray(b[0] === 0xEF ? 3 : 0, 64));
        if (/\.xml$/i.test(a.nombre) || /^\s*</.test(cab)) return agregarXml(a.nombre, b);
        res.errores.push({ archivo: a.nombre, motivo: 'Solo se leen archivos .xml y .zip.' });
      });
    }, Promise.resolve()).then(function () {
      res.documentos.sort(function (x, y) { return x.fecha < y.fecha ? -1 : x.fecha > y.fecha ? 1 : (x.numero < y.numero ? -1 : x.numero > y.numero ? 1 : 0); });
      return res;
    });
  }

  /* Totales por moneda. Las notas crédito restan. */
  function totales(documentos) {
    var porMoneda = {};
    documentos.forEach(function (d) {
      var t = porMoneda[d.moneda] || (porMoneda[d.moneda] = { moneda: d.moneda, n: 0, subtotal: 0, iva: 0, otros: 0, retenciones: 0, total: 0 });
      t.n++;
      ['subtotal', 'iva', 'otros', 'retenciones', 'total'].forEach(function (k) { t[k] = r2(t[k] + d.signo * d[k]); });
    });
    return Object.keys(porMoneda).sort(function (a, b) { return a === 'COP' ? -1 : b === 'COP' ? 1 : a < b ? -1 : 1; }).map(function (k) { return porMoneda[k]; });
  }

  /* ---------- Formato para la gente: 1.234.567,89 y dd/mm/aaaa ---------- */

  function pesos(v) {
    var neg = v < 0, a = Math.abs(Math.round(v * 100)) / 100;
    var partes = a.toFixed(2).split('.');
    var ent = partes[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (neg ? '−' : '') + ent + ',' + partes[1];
  }
  function fecha(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    return m ? m[3] + '/' + m[2] + '/' + m[1] : (iso || '');
  }

  var Facturas = {
    leerXml: leerXml, decodificar: decodificar, leerDocumento: leerDocumento,
    procesar: procesar, totales: totales, pesos: pesos, fecha: fecha, TIPOS_ID: TIPOS_ID
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Facturas;
  else raiz.Facturas = Facturas;
})(this);
