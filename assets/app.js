/* Interfaz: recibe los archivos, arma la tabla y descarga el Excel.
   Nada sale del computador: los archivos se leen en el navegador y no se guardan. */
(function () {
  'use strict';

  var F = window.Facturas, X = window.Excel, Z = window.Zip;
  var $ = function (s) { return document.querySelector(s); };
  var EJEMPLOS = [
    'ejemplos/FEPR1001_papeleria_ficticia.xml',
    'ejemplos/NCPR15_nota_credito_ficticia.xml',
    'ejemplos/RFP2045_restaurante_ficticio.zip',
    'ejemplos/FEX12_exportacion_ficticia.xml',
    'ejemplos/FEPR1001_reenviada_ficticia.xml'
  ];

  var estado = vacio();
  var ocupado = false;
  function vacio() { return { documentos: [], errores: [], repetidas: [] }; }

  function el(tag, clase, texto) {
    var n = document.createElement(tag);
    if (clase) n.className = clase;
    if (texto != null) n.textContent = texto;
    return n;
  }
  function plural(n, uno, varios) { return n + ' ' + (n === 1 ? uno : varios); }
  function claseTipo(d) {
    if (d.raiz === 'CreditNote') return 'tipo tipo--credito';
    if (d.raiz === 'DebitNote') return 'tipo tipo--debito';
    if (d.tipo === 'Factura de exportación') return 'tipo tipo--export';
    return 'tipo';
  }
  function corto(cufe) { return cufe.length > 16 ? cufe.slice(0, 8) + '…' + cufe.slice(-6) : cufe; }

  function celdaPersona(p) {
    var td = el('td', 'persona');
    td.appendChild(el('span', '', p.nombre || '[sin nombre]'));
    if (p.idTexto) td.appendChild(el('span', 'sec', p.idTexto));
    return td;
  }
  function celdaNum(v) { return el('td', 'n', F.pesos(v)); }

  function pintar() {
    var docs = estado.documentos;
    var cuerpo = $('#cuerpo'), pie = $('#pie');
    cuerpo.textContent = ''; pie.textContent = '';
    if (!docs.length) {
      var tr0 = el('tr'); var td0 = el('td', 'vacio', 'Todavía no hay facturas. Arrástralas arriba o prueba con los ejemplos.');
      td0.colSpan = 10; tr0.appendChild(td0); cuerpo.appendChild(tr0);
    }
    docs.forEach(function (d) {
      var tr = el('tr', d.raiz === 'CreditNote' ? 'nota-credito' : '');
      var tdTipo = el('td'); var etq = el('span', claseTipo(d), d.tipo === 'Factura de exportación' ? 'Exportación' : d.tipo === 'Factura de contingencia' ? 'Contingencia' : d.tipo); etq.title = d.tipo; tdTipo.appendChild(etq); tr.appendChild(tdTipo);
      tr.appendChild(el('td', '', d.numero));
      tr.appendChild(el('td', '', F.fecha(d.fecha)));
      tr.appendChild(celdaPersona(d.emisor));
      tr.appendChild(celdaPersona(d.adquiriente));
      tr.appendChild(celdaNum(d.signo * d.subtotal));
      tr.appendChild(celdaNum(d.signo * d.iva));
      var tdOtros = celdaNum(d.signo * d.otros);
      if (d.otrosNombres) tdOtros.appendChild(el('span', 'sec', d.otrosNombres));
      tr.appendChild(tdOtros);
      var tdTot = celdaNum(d.signo * d.total); tdTot.appendChild(el('span', 'sec', d.moneda)); tr.appendChild(tdTot);
      var tdC = el('td'); var c = el('code', 'cufe', corto(d.cufe)); c.title = d.cufe; tdC.appendChild(c); tr.appendChild(tdC);
      cuerpo.appendChild(tr);
    });
    F.totales(docs).forEach(function (t) {
      var tr = el('tr');
      var td = el('td', '', 'Total ' + t.moneda + ' · ' + plural(t.n, 'documento', 'documentos')); td.colSpan = 5; tr.appendChild(td);
      tr.appendChild(celdaNum(t.subtotal)); tr.appendChild(celdaNum(t.iva)); tr.appendChild(celdaNum(t.otros));
      var tdT = celdaNum(t.total); tdT.appendChild(el('span', 'sec', t.moneda)); tr.appendChild(tdT); tr.appendChild(el('td'));
      pie.appendChild(tr);
    });

    var res = $('#resumen'); res.textContent = '';
    if (docs.length || estado.errores.length || estado.repetidas.length) {
      var facturas = docs.filter(function (d) { return d.raiz === 'Invoice'; }).length;
      var nc = docs.filter(function (d) { return d.raiz === 'CreditNote'; }).length;
      var nd = docs.filter(function (d) { return d.raiz === 'DebitNote'; }).length;
      var chips = [['', plural(facturas, 'factura', 'facturas')]];
      if (nc) chips.push(['', plural(nc, 'nota crédito', 'notas crédito')]);
      if (nd) chips.push(['', plural(nd, 'nota débito', 'notas débito')]);
      if (estado.repetidas.length) chips.push(['alerta-chip', plural(estado.repetidas.length, 'repetida', 'repetidas')]);
      if (estado.errores.length) chips.push(['alerta-chip', plural(estado.errores.length, 'sin leer', 'sin leer')]);
      chips = chips.map(function (ch) { var partes = ch[1].split(' '); return [ch[0], partes.shift(), ' ' + partes.join(' ')]; });
      F.totales(docs).forEach(function (t) { chips.push(['total-chip', F.pesos(t.total), ' ' + t.moneda + ' en total']); });
      chips.forEach(function (ch) {
        var li = el('li', ch[0]);
        li.appendChild(el('strong', '', ch[1])); li.appendChild(document.createTextNode(ch[2]));
        res.appendChild(li);
      });
    }

    var av = $('#avisos'); av.textContent = '';
    var lista = [];
    estado.errores.forEach(function (e) { lista.push(['No pude leer «' + e.archivo + '»: ', e.motivo]); });
    estado.repetidas.forEach(function (r) { lista.push(['Repetida: «' + r.archivo + '» ', 'es la misma ' + (r.numero || 'factura') + ' de «' + r.igualA + '». No se sumó dos veces.']); });
    docs.forEach(function (d) { d.avisos.forEach(function (a) { lista.push(['Ojo con «' + d.archivo + '»: ', a]); }); });
    lista.forEach(function (x) { var li = el('li'); li.appendChild(el('strong', '', x[0])); li.appendChild(document.createTextNode(x[1])); av.appendChild(li); });
    av.hidden = !lista.length;
    av.className = 'avisos' + (estado.errores.length ? '' : ' avisos--suave');

    $('#descargar').disabled = !docs.length;
    $('#borrar').disabled = !(docs.length || lista.length);
  }

  function cargar(archivos) {
    if (ocupado || !archivos.length) return;
    ocupado = true;
    $('#estado').textContent = 'Leyendo ' + plural(archivos.length, 'archivo', 'archivos') + '…';
    Promise.all(archivos.map(function (f) {
      return f.arrayBuffer().then(function (ab) { return { nombre: f.name, bytes: new Uint8Array(ab) }; });
    })).then(function (lista) {
      var antes = estado.documentos.length;
      return F.procesar(lista, estado, Z).then(function (r) {
        estado = r;
        var nuevos = estado.documentos.length - antes;
        $('#estado').textContent = 'Listo: ' + plural(nuevos, 'documento nuevo', 'documentos nuevos') + ' en la tabla.';
      });
    }).catch(function (e) {
      $('#estado').textContent = 'Algo salió mal al leer los archivos: ' + e.message;
    }).then(function () { ocupado = false; pintar(); });
  }

  function ejemplos() {
    $('#estado').textContent = 'Cargando los ejemplos…';
    Promise.all(EJEMPLOS.map(function (ruta) {
      return fetch(ruta).then(function (r) {
        if (!r.ok) throw new Error('no se encontró ' + ruta);
        return r.blob();
      }).then(function (b) { return new File([b], ruta.split('/').pop()); });
    })).then(cargar, function (e) {
      $('#estado').textContent = 'No se pudieron cargar los ejemplos (' + e.message + '). Abre la página desde un servidor, no como archivo.';
    });
  }

  function descargar() {
    var bytes = X.crear(estado, F.totales(estado.documentos), Z);
    var blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    var hoy = new Date();
    var dd = function (n) { return (n < 10 ? '0' : '') + n; };
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'facturas-electronicas-' + dd(hoy.getDate()) + '-' + dd(hoy.getMonth() + 1) + '-' + hoy.getFullYear() + '.xlsx';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }

  function iniciar() {
    var zona = $('#zona'), input = $('#archivos');
    input.addEventListener('change', function () { cargar(Array.prototype.slice.call(input.files)); input.value = ''; });
    ['dragenter', 'dragover'].forEach(function (ev) {
      window.addEventListener(ev, function (e) { e.preventDefault(); zona.classList.add('encima'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      window.addEventListener(ev, function (e) { if (ev === 'drop' || e.target === zona || !e.relatedTarget) zona.classList.remove('encima'); });
    });
    window.addEventListener('drop', function (e) {
      e.preventDefault();
      if (e.dataTransfer && e.dataTransfer.files) cargar(Array.prototype.slice.call(e.dataTransfer.files));
    });
    $('#ejemplos').addEventListener('click', ejemplos);
    $('#descargar').addEventListener('click', descargar);
    $('#borrar').addEventListener('click', function () { estado = vacio(); $('#estado').textContent = 'Tabla vacía.'; pintar(); });
    pintar();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
