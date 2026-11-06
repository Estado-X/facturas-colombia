/* Lector y escritor de .zip mínimo, sin librerías.
   - Leer: archivos guardados (método 0) o comprimidos con deflate (método 8), que
     descomprime el propio navegador con DecompressionStream('deflate-raw').
   - Escribir: archivos sin comprimir (método 0), con CRC-32. Es lo que necesita el .xlsx.
   No soporta zip cifrados ni ZIP64 (archivos de más de 4 GB). */
(function (raiz) {
  'use strict';

  var LIMITE_ENTRADA = 50 * 1024 * 1024; // 50 MB descomprimidos por archivo interno

  var TABLA_CRC = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = TABLA_CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function u16(b, o) { return b[o] | (b[o + 1] << 8); }
  function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }

  function esZip(bytes) {
    return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4B && (bytes[2] === 3 || bytes[2] === 5) && (bytes[3] === 4 || bytes[3] === 6);
  }

  function nombre(bytes, utf8) {
    try { return new TextDecoder(utf8 ? 'utf-8' : 'utf-8', { fatal: !utf8 }).decode(bytes); }
    catch (e) { return new TextDecoder('latin1').decode(bytes); }
  }

  /* Devuelve la lista de archivos del zip: [{ nombre, metodo, tamano, leer() }].
     leer() es asíncrona y devuelve un Uint8Array con el contenido. */
  function listar(bytes) {
    if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
    var fin = -1;
    for (var i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
      if (u32(bytes, i) === 0x06054B50) { fin = i; break; }
    }
    if (fin < 0) throw new Error('El .zip está dañado o incompleto.');
    var total = u16(bytes, fin + 10);
    var inicio = u32(bytes, fin + 16);
    if (inicio === 0xFFFFFFFF || total === 0xFFFF) throw new Error('El .zip es demasiado grande (ZIP64) para leerlo aquí.');
    var lista = [];
    var p = inicio;
    for (var n = 0; n < total; n++) {
      if (p + 46 > bytes.length || u32(bytes, p) !== 0x02014B50) throw new Error('El .zip está dañado (índice ilegible).');
      var banderas = u16(bytes, p + 8);
      var metodo = u16(bytes, p + 10);
      var comprimido = u32(bytes, p + 20);
      var tamano = u32(bytes, p + 24);
      var ln = u16(bytes, p + 28), le = u16(bytes, p + 30), lc = u16(bytes, p + 32);
      var local = u32(bytes, p + 42);
      var nom = nombre(bytes.subarray(p + 46, p + 46 + ln), (banderas & 0x800) !== 0);
      p += 46 + ln + le + lc;
      if (/\/$/.test(nom)) continue; // carpeta
      lista.push(entrada(bytes, nom, banderas, metodo, comprimido, tamano, local));
    }
    return lista;
  }

  function entrada(bytes, nom, banderas, metodo, comprimido, tamano, local) {
    return {
      nombre: nom, metodo: metodo, tamano: tamano,
      leer: function () {
        if (banderas & 1) return Promise.reject(new Error('El archivo «' + nom + '» del .zip tiene clave.'));
        if (tamano > LIMITE_ENTRADA) return Promise.reject(new Error('El archivo «' + nom + '» del .zip es demasiado grande.'));
        if (u32(bytes, local) !== 0x04034B50) return Promise.reject(new Error('El .zip está dañado.'));
        var datos = local + 30 + u16(bytes, local + 26) + u16(bytes, local + 28);
        var crudo = bytes.subarray(datos, datos + comprimido);
        if (metodo === 0) return Promise.resolve(crudo.slice());
        if (metodo === 8) return inflar(crudo);
        return Promise.reject(new Error('El archivo «' + nom + '» usa una compresión que no se puede abrir aquí (método ' + metodo + ').'));
      }
    };
  }

  function inflar(crudo) {
    if (typeof DecompressionStream === 'undefined') return Promise.reject(new Error('Tu navegador no puede abrir .zip. Actualízalo o descomprime el .zip y arrastra los .xml.'));
    var flujo = new Blob([crudo]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(flujo).arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
  }

  /* archivos: [{ nombre, datos: Uint8Array | string }] → Uint8Array del .zip (sin comprimir). */
  function crear(archivos, fecha) {
    var enc = new TextEncoder();
    var f = fecha || new Date();
    var hora = (f.getHours() << 11) | (f.getMinutes() << 5) | (f.getSeconds() >> 1);
    var dia = ((f.getFullYear() - 1980) << 9) | ((f.getMonth() + 1) << 5) | f.getDate();
    var partes = [], central = [], desplazamiento = 0;
    archivos.forEach(function (a) {
      var nom = enc.encode(a.nombre);
      var datos = typeof a.datos === 'string' ? enc.encode(a.datos) : a.datos;
      var crc = crc32(datos);
      var cab = new Uint8Array(30 + nom.length);
      var v = new DataView(cab.buffer);
      v.setUint32(0, 0x04034B50, true); v.setUint16(4, 20, true); v.setUint16(6, 0x800, true); v.setUint16(8, 0, true);
      v.setUint16(10, hora, true); v.setUint16(12, dia, true); v.setUint32(14, crc, true);
      v.setUint32(18, datos.length, true); v.setUint32(22, datos.length, true);
      v.setUint16(26, nom.length, true); v.setUint16(28, 0, true);
      cab.set(nom, 30);
      var cen = new Uint8Array(46 + nom.length);
      var w = new DataView(cen.buffer);
      w.setUint32(0, 0x02014B50, true); w.setUint16(4, 20, true); w.setUint16(6, 20, true); w.setUint16(8, 0x800, true);
      w.setUint16(10, 0, true); w.setUint16(12, hora, true); w.setUint16(14, dia, true); w.setUint32(16, crc, true);
      w.setUint32(20, datos.length, true); w.setUint32(24, datos.length, true); w.setUint16(28, nom.length, true);
      w.setUint32(42, desplazamiento, true);
      cen.set(nom, 46);
      partes.push(cab, datos); central.push(cen);
      desplazamiento += cab.length + datos.length;
    });
    var tamCentral = central.reduce(function (s, c) { return s + c.length; }, 0);
    var fin = new Uint8Array(22);
    var x = new DataView(fin.buffer);
    x.setUint32(0, 0x06054B50, true); x.setUint16(8, archivos.length, true); x.setUint16(10, archivos.length, true);
    x.setUint32(12, tamCentral, true); x.setUint32(16, desplazamiento, true);
    var todo = partes.concat(central, [fin]);
    var largo = todo.reduce(function (s, c) { return s + c.length; }, 0);
    var out = new Uint8Array(largo), o = 0;
    todo.forEach(function (c) { out.set(c, o); o += c.length; });
    return out;
  }

  var Zip = { esZip: esZip, listar: listar, crear: crear, crc32: crc32 };
  if (typeof module !== 'undefined' && module.exports) module.exports = Zip;
  else raiz.Zip = Zip;
})(this);
