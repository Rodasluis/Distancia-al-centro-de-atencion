/**
 * Orquestación: estado, filtros, sincronización entre lista, mapa y ficha,
 * y persistencia del estado en la URL para poder compartir una búsqueda.
 */

import { cargarDirectorio, cargarIconos, filtrar } from './datos.js';
import { MapaCentros } from './mapa.js';
import { pintarLista, construirFicha } from './ui.js';

/** Valores del deslizador de radio, en kilómetros. El último es «sin límite». */
const RADIOS = [1, 2, 3, 5, 7.5, 10, 15, 20, 25, 30, 40, 50, 75, 100, 150, 250, null];
const RADIO_POR_DEFECTO = 8;   // índice de 25 km

const $ = (s) => document.querySelector(s);

const el = {
  panel: $('#panel'),
  lista: $('#lista'),
  conteo: $('#resultados-conteo'),
  aviso: $('#resultados-aviso'),
  dep: $('#f-dep'),
  prov: $('#f-prov'),
  dist: $('#f-dist'),
  tipo: $('#f-tipo'),
  q: $('#f-q'),
  orden: $('#f-orden'),
  radio: $('#radio'),
  radioValor: $('#radio-valor'),
  radioControl: $('#radio-control'),
  btnGeo: $('#btn-geo'),
  btnGeoTxt: $('#btn-geo-txt'),
  btnQuitarUbicacion: $('#btn-quitar-ubicacion'),
  btnLimpiar: $('#btn-limpiar'),
  btnTema: $('#btn-tema'),
  btnAyuda: $('#btn-ayuda'),
  ubicacionEstado: $('#ubicacion-estado'),
  ficha: $('#ficha'),
  fichaTipo: $('#ficha-tipo'),
  fichaTitulo: $('#ficha-titulo'),
  fichaCuerpo: $('#ficha-cuerpo'),
  fichaPie: $('#ficha-pie'),
  acerca: $('#acerca'),
  cargando: $('#cargando'),
  migas: $('#migas'),
  pieMeta: $('#pie-meta'),
};

const estado = {
  origen: null,          // {lat, lon, fuente}
  radioIdx: RADIO_POR_DEFECTO,
  dep: '', prov: '', dist: '', tipo: '', q: '',
  orden: 'nombre',
  seleccionado: null,
};

let DIR = null;
let ICONOS = null;
/** Marca que el radio se soltó solo para no dejar el territorio sin resultados. */
let radioSoltadoPorTerritorio = false;
let mapa = null;
let ultimaLista = [];
let ultimoFoco = null;

const radioKm = () => (estado.origen ? RADIOS[estado.radioIdx] : null);

/* ============================================================== tema == */

function temaOscuroActivo() {
  const t = document.documentElement.dataset.tema;
  if (t === 'oscuro') return true;
  if (t === 'claro') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function alternarTema() {
  const ahora = temaOscuroActivo();
  document.documentElement.dataset.tema = ahora ? 'claro' : 'oscuro';
  try { localStorage.setItem('mimp-tema', document.documentElement.dataset.tema); } catch { /* sin almacenamiento */ }
  mapa?.aplicarTema(!ahora);
}

function restaurarTema() {
  try {
    const t = localStorage.getItem('mimp-tema');
    if (t === 'claro' || t === 'oscuro') document.documentElement.dataset.tema = t;
  } catch { /* sin almacenamiento */ }
}

/* ============================================================== URL === */

function leerURL() {
  const p = new URLSearchParams(location.hash.slice(1));
  if (p.has('dep')) estado.dep = p.get('dep');
  if (p.has('prov')) estado.prov = p.get('prov');
  if (p.has('dist')) estado.dist = p.get('dist');
  if (p.has('tipo')) estado.tipo = p.get('tipo');
  if (p.has('q')) estado.q = p.get('q');
  if (p.has('orden')) estado.orden = p.get('orden');
  if (p.has('r')) {
    const i = Number(p.get('r'));
    if (Number.isInteger(i) && i >= 0 && i < RADIOS.length) estado.radioIdx = i;
  }
  if (p.has('o')) {
    const [la, lo] = p.get('o').split(',').map(Number);
    if (Number.isFinite(la) && Number.isFinite(lo)) {
      estado.origen = { lat: la, lon: lo, fuente: 'url' };
      estado.orden = p.get('orden') || 'cercania';
    }
  }
  if (p.has('c')) {
    const id = Number(p.get('c'));
    if (Number.isFinite(id)) estado.seleccionado = id;
  }
}

let escrituraURL;
function escribirURL() {
  clearTimeout(escrituraURL);
  escrituraURL = setTimeout(() => {
    const p = new URLSearchParams();
    if (estado.dep) p.set('dep', estado.dep);
    if (estado.prov) p.set('prov', estado.prov);
    if (estado.dist) p.set('dist', estado.dist);
    if (estado.tipo) p.set('tipo', estado.tipo);
    if (estado.q) p.set('q', estado.q);
    if (estado.orden !== 'nombre') p.set('orden', estado.orden);
    if (estado.origen) {
      p.set('o', `${estado.origen.lat.toFixed(5)},${estado.origen.lon.toFixed(5)}`);
      p.set('r', String(estado.radioIdx));
    }
    if (estado.seleccionado != null) p.set('c', String(estado.seleccionado));
    const s = p.toString();
    history.replaceState(null, '', s ? `#${s}` : location.pathname + location.search);
  }, 220);
}

/* ========================================================== filtros == */

function opcion(valor, texto) {
  const o = document.createElement('option');
  o.value = valor;
  o.textContent = texto;
  return o;
}

function llenarDepartamentos() {
  const cuenta = new Map();
  for (const c of DIR.centros) cuenta.set(c.ccdd, (cuenta.get(c.ccdd) || 0) + 1);
  el.dep.replaceChildren(opcion('', 'Todos los departamentos'));
  for (const d of DIR.catalogo.departamentos) {
    el.dep.appendChild(opcion(d.id, `${d.nombre} (${cuenta.get(d.id) || 0})`));
  }
  el.dep.value = estado.dep;
}

function llenarProvincias() {
  el.prov.replaceChildren(opcion('', 'Todas las provincias'));
  el.prov.disabled = !estado.dep;
  if (estado.dep) {
    const cuenta = new Map();
    for (const c of DIR.centros) {
      if (c.ccdd === estado.dep) cuenta.set(c.ccpp, (cuenta.get(c.ccpp) || 0) + 1);
    }
    for (const p of DIR.catalogo.provincias.filter((x) => x.ccdd === estado.dep)) {
      el.prov.appendChild(opcion(p.id, `${p.nombre} (${cuenta.get(p.id) || 0})`));
    }
  }
  if ([...el.prov.options].some((o) => o.value === estado.prov)) el.prov.value = estado.prov;
  else { estado.prov = ''; el.prov.value = ''; }
}

function llenarDistritos() {
  el.dist.replaceChildren(opcion('', 'Todos los distritos'));
  el.dist.disabled = !estado.prov;
  if (estado.prov) {
    const cuenta = new Map();
    for (const c of DIR.centros) {
      if (c.ccpp === estado.prov) cuenta.set(c.ubigeo, (cuenta.get(c.ubigeo) || 0) + 1);
    }
    for (const d of DIR.catalogo.distritos.filter((x) => x.ccpp === estado.prov)) {
      el.dist.appendChild(opcion(d.id, `${d.nombre} (${cuenta.get(d.id) || 0})`));
    }
  }
  if ([...el.dist.options].some((o) => o.value === estado.dist)) el.dist.value = estado.dist;
  else { estado.dist = ''; el.dist.value = ''; }
}

function llenarTipos() {
  const cuenta = new Map();
  for (const c of DIR.centros) cuenta.set(c.tipo, (cuenta.get(c.tipo) || 0) + 1);
  el.tipo.replaceChildren(opcion('', 'Todos los servicios'));
  for (const t of DIR.catalogo.tipos) {
    el.tipo.appendChild(opcion(t, `${t} (${cuenta.get(t) || 0})`));
  }
  el.tipo.value = estado.tipo;
}

/* ======================================================== renderizado = */

function textoRadio() {
  const r = RADIOS[estado.radioIdx];
  return r === null ? 'Sin límite' : r < 1 ? `${r * 1000} m` : `${String(r).replace('.', ',')} km`;
}

function refrescar({ moverMapa = false } = {}) {
  const { lista, fueraDeRadio, totalTerritorial } = filtrar(DIR.centros, {
    origen: estado.origen,
    radioKm: radioKm(),
    dep: estado.dep,
    prov: estado.prov,
    dist: estado.dist,
    tipo: estado.tipo,
    q: estado.q,
    orden: estado.orden,
  });
  /*
   * Territorio elegido + ubicación activa dejaba la pantalla en blanco: el
   * radio por defecto (25 km) descarta todo lo que está lejos de ti, aunque
   * sea justo lo que acabas de pedir ver. Cuando hay un filtro territorial,
   * el radio se suelta solo en vez de vaciar el mapa.
   */
  if (!lista.length && estado.origen && fueraDeRadio > 0
      && territorioActual() && RADIOS[estado.radioIdx] !== null) {
    estado.radioIdx = RADIOS.length - 1;
    el.radio.value = String(estado.radioIdx);
    el.radioValor.textContent = textoRadio();
    radioSoltadoPorTerritorio = true;
    refrescar({ moverMapa });
    return;
  }

  ultimaLista = lista;

  /* encabezado */
  const n = lista.length;
  el.conteo.innerHTML = n === 1
    ? '<strong>1</strong> centro encontrado'
    : `<strong>${n}</strong> centros encontrados`;

  /* avisos contextuales */
  const notas = [];
  if (estado.origen && fueraDeRadio > 0) {
    notas.push(`${fueraDeRadio} ${fueraDeRadio === 1 ? 'centro queda' : 'centros quedan'} `
      + `fuera del radio de ${textoRadio().toLowerCase()}.`);
  }
  if (radioSoltadoPorTerritorio) {
    notas.length = 0;
    notas.push('Se quitó el límite de distancia para poder mostrarte los centros '
      + 'del territorio que elegiste; siguen ordenados del más cercano al más lejano.');
    radioSoltadoPorTerritorio = false;
  } else if (notas.length) {
    notas.push('Amplía el radio o quita tu ubicación para verlos todos.');
  }
  el.aviso.textContent = notas.join(' ');
  el.aviso.hidden = notas.length === 0;

  /* lista y mapa */
  const hayFiltroTerritorial = Boolean(estado.dep || estado.prov || estado.dist);
  let mensajeVacio;
  let accionVacio = null;
  if (!lista.length && estado.origen && fueraDeRadio > 0) {
    mensajeVacio = hayFiltroTerritorial
      ? `Ningún centro del territorio seleccionado está a menos de ${textoRadio().toLowerCase()} `
        + 'de tu ubicación. Los centros existen, pero quedan más lejos.'
      : `No hay centros a menos de ${textoRadio().toLowerCase()} de tu ubicación.`;
    accionVacio = { accion: 'sin-radio', texto: 'Buscar sin límite de distancia' };
  } else if (!lista.length && totalTerritorial === 0) {
    mensajeVacio = 'Ningún centro coincide con estos filtros. Prueba a quitar alguno.';
    accionVacio = { accion: 'limpiar', texto: 'Limpiar filtros' };
  }

  pintarLista(el.lista, lista, {
    hayOrigen: Boolean(estado.origen),
    ordenCercania: estado.orden === 'cercania',
    seleccionado: estado.seleccionado,
    marcaDe: (tipo) => mapa.marcaDe(tipo),
    mensajeVacio,
    accionVacio,
  });
  mapa.dibujarCentros(lista);
  mapa.dibujarOrigen(estado.origen, radioKm());
  // El remarcado sigue al filtro en todo refresco, también cuando se limpia.
  mapa.resaltarTerritorio(territorioActual());
  pintarMigas();

  // La ficha no debe sobrevivir a un filtro que deja fuera a su centro.
  if (estado.seleccionado != null && !lista.some((c) => c.id === estado.seleccionado)) {
    cerrarFicha(false);
  } else if (estado.seleccionado != null) {
    mapa.resaltar(estado.seleccionado, false);
  }

  if (moverMapa) {
    if (territorioActual()) mapa.encuadrarTerritorio(territorioActual());
    else if (estado.origen) mapa.encuadrarRadio(estado.origen, radioKm());
    else mapa.encuadrarCentros(lista);
  }

  escribirURL();
}

/** Código del territorio seleccionado, en el nivel más fino elegido. */
const territorioActual = () => estado.dist || estado.prov || estado.dep || '';

/**
 * Ruta territorial sobre el mapa. Sin ella, una vez dentro de un distrito
 * sólo se podía salir con «Limpiar»: no hay otro territorio a la vista que
 * pulsar, porque la pantalla entera cae dentro del que ya está elegido.
 */
function pintarMigas() {
  const nombre = (lista, id) => lista.find((x) => x.id === id)?.nombre || id;
  const pasos = [{ codigo: '', texto: 'Perú' }];
  if (estado.dep) pasos.push({ codigo: estado.dep, texto: nombre(DIR.catalogo.departamentos, estado.dep) });
  if (estado.prov) pasos.push({ codigo: estado.prov, texto: nombre(DIR.catalogo.provincias, estado.prov) });
  if (estado.dist) pasos.push({ codigo: estado.dist, texto: nombre(DIR.catalogo.distritos, estado.dist) });

  el.migas.innerHTML = pasos.map((p, i) => {
    const ultimo = i === pasos.length - 1;
    const texto = p.texto.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    return (i ? '<span class="migas__sep" aria-hidden="true">›</span>' : '')
      + (ultimo
        ? `<span class="migas__actual" aria-current="location">${texto}</span>`
        : `<button class="migas__paso" type="button" data-ir="${p.codigo}">${texto}</button>`);
  }).join('');
  el.migas.hidden = pasos.length === 1;
}

/** Mensaje pasajero en la franja de avisos; el próximo refresco lo sustituye. */
let temporizadorAviso;
function avisoTemporal(texto) {
  clearTimeout(temporizadorAviso);
  el.aviso.textContent = texto;
  el.aviso.hidden = false;
  temporizadorAviso = setTimeout(() => refrescar(), 5000);
}

/**
 * El detalle de los límites acompaña al filtro: sin filtro se ven los
 * departamentos; con departamento, sus provincias; con provincia o
 * distrito, los distritos de ese departamento.
 */
async function sincronizarLimites() {
  const ccdd = estado.dep || null;
  let nivel;
  if (estado.prov || estado.dist) nivel = 'distritos';
  else if (ccdd) nivel = 'provincias';
  else nivel = 'departamentos';

  await mapa.mostrarLimites(nivel, ccdd);
}

/**
 * Clic sobre un territorio del mapa: fija el filtro correspondiente según la
 * longitud del ubigeo (2 = departamento, 4 = provincia, 6 = distrito) y baja
 * un nivel. Volver a pulsar el territorio ya seleccionado sube un nivel, para
 * poder retroceder sin tocar los desplegables.
 */
async function seleccionarTerritorio(ubigeo, nombre, { alternar = true } = {}) {
  // Los desplegables sólo listan territorios con centros, así que seleccionar
  // uno vacío se descartaría en silencio. Se encuadra igual y se explica.
  const campo = ubigeo.length === 2 ? 'ccdd' : ubigeo.length === 4 ? 'ccpp' : 'ubigeo';
  if (!DIR.centros.some((c) => c[campo] === ubigeo)) {
    await mapa.encuadrarTerritorio(ubigeo);
    avisoTemporal(nombre
      ? `${nombre} no tiene centros de atención registrados en el directorio.`
      : 'Ese territorio no tiene centros de atención registrados en el directorio.');
    return;
  }

  // Pulsar el territorio ya elegido lo deselecciona, salvo cuando el clic
  // viene de un grupo de centros: ahí sólo cabe bajar, nunca deshacer.
  const yaSeleccionado = alternar && territorioActual() === ubigeo;
  if (!alternar && territorioActual() === ubigeo) return;

  if (ubigeo.length === 2) {
    estado.dep = yaSeleccionado ? '' : ubigeo;
    estado.prov = ''; estado.dist = '';
  } else if (ubigeo.length === 4) {
    estado.dep = ubigeo.slice(0, 2);
    estado.prov = yaSeleccionado ? '' : ubigeo;
    estado.dist = '';
  } else {
    estado.dep = ubigeo.slice(0, 2);
    estado.prov = ubigeo.slice(0, 4);
    estado.dist = yaSeleccionado ? '' : ubigeo;
  }

  // Los desplegables deben reflejar lo que se acaba de pulsar en el mapa.
  el.dep.value = estado.dep;
  llenarProvincias();
  llenarDistritos();
  await aplicarTerritorio();
}

/** Recalcula capas y encuadre tras cambiar un filtro territorial. */
async function aplicarTerritorio() {
  await sincronizarLimites();
  refrescar();
  // El encuadre territorial manda sobre el del radio: el usuario acaba de
  // pedir explícitamente ver esa zona.
  // Volver a «Perú» desde la ruta significa ver el país entero, aunque haya
  // una ubicación activa: el encuadre sigue al territorio que se ha pulsado.
  await mapa.encuadrarTerritorio(territorioActual());
}

/* =========================================================== ficha === */

function abrirFicha(id) {
  const c = ultimaLista.find((x) => x.id === id) || DIR.centros.find((x) => x.id === id);
  if (!c) return;

  estado.seleccionado = id;
  ultimoFoco = document.activeElement;

  el.fichaTipo.textContent = c.tipo;
  el.fichaTitulo.textContent = c.nombre;
  const { cuerpo, pie } = construirFicha(c, estado.origen);
  el.fichaCuerpo.innerHTML = cuerpo;
  el.fichaPie.innerHTML = pie;
  el.fichaCuerpo.scrollTop = 0;

  el.ficha.hidden = false;
  el.ficha.querySelector('.ficha__panel').focus();

  mapa.resaltar(id, true);
  el.lista.querySelectorAll('.item').forEach((b) => {
    b.classList.toggle('is-activo', Number(b.dataset.id) === id);
  });
  escribirURL();
}

/**
 * @param {boolean} devolverFoco  false cuando la ficha se cierra sola por un
 *   cambio de filtro: mover el foco interrumpiría a quien está escribiendo.
 */
function cerrarFicha(devolverFoco = true) {
  el.ficha.hidden = true;
  estado.seleccionado = null;
  mapa.limpiarResaltado();
  el.lista.querySelectorAll('.item.is-activo').forEach((b) => b.classList.remove('is-activo'));
  if (devolverFoco) ultimoFoco?.focus?.();
  escribirURL();
}

/** Copia la URL actual, que ya lleva el centro y los filtros abiertos. */
async function copiarEnlace(boton) {
  const original = boton.title;
  try {
    await navigator.clipboard.writeText(location.href);
    boton.title = 'Enlace copiado';
    boton.classList.add('is-ok');
  } catch {
    boton.title = 'No se pudo copiar; copia la dirección de la barra';
  }
  setTimeout(() => { boton.title = original; boton.classList.remove('is-ok'); }, 2200);
}

function abrirAcerca() {
  ultimoFoco = document.activeElement;
  el.acerca.hidden = false;
  el.acerca.querySelector('.ficha__panel').focus();
}
const cerrarAcerca = () => { el.acerca.hidden = true; ultimoFoco?.focus?.(); };

/* ====================================================== geolocalización */

function estadoUbicacion(texto, clase = '') {
  el.ubicacionEstado.textContent = texto;
  el.ubicacionEstado.className = `ubicacion__estado${clase ? ` ${clase}` : ''}`;
}

function fijarOrigen(origen, etiqueta) {
  estado.origen = origen;
  estado.orden = 'cercania';
  el.orden.value = 'cercania';
  el.radioControl.hidden = false;
  el.btnGeoTxt.textContent = 'Actualizar ubicación';
  estadoUbicacion(etiqueta, 'is-ok');
  refrescar({ moverMapa: true });
}

/**
 * Si ya hay ubicación, sólo recentra el mapa; si no, la pide.
 * Es lo que hace el botón del mapa y el de la barra.
 */
function usarMiUbicacion() {
  if (estado.origen) {
    mapa.centrarEnVisible([estado.origen.lat, estado.origen.lon],
      Math.max(mapa.zoomActual ?? 12, 12));
    return;
  }
  pedirGeolocalizacion();
}

function pedirGeolocalizacion() {
  if (!('geolocation' in navigator)) {
    estadoUbicacion('Tu navegador no permite geolocalización.', 'is-error');
    return;
  }
  el.btnGeo.disabled = true;
  mapa?.estadoBotonUbicacion('buscando');
  el.radioControl.hidden = false;
  estadoUbicacion('Obteniendo tu ubicación…');

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      el.btnGeo.disabled = false;
      mapa?.estadoBotonUbicacion('activa');
      const { latitude, longitude, accuracy } = pos.coords;
      const precision = accuracy ? ` · precisión ≈ ${Math.round(accuracy)} m` : '';
      fijarOrigen({ lat: latitude, lon: longitude, fuente: 'gps' },
        `Ubicación detectada${precision}`);
    },
    (err) => {
      el.btnGeo.disabled = false;
      mapa?.estadoBotonUbicacion('');
      el.radioControl.hidden = !estado.origen;
      const motivos = {
        1: 'Permiso de ubicación denegado. Puedes buscar por departamento, provincia y distrito, '
          + 'o permitirlo desde el icono de la barra de direcciones.',
        2: 'No se pudo determinar tu posición. Inténtalo de nuevo.',
        3: 'La búsqueda de ubicación tardó demasiado. Inténtalo de nuevo.',
      };
      const texto = motivos[err.code] || 'No se pudo obtener tu ubicación.';
      estadoUbicacion(texto, 'is-error');
      // Sin ubicación no hay ranking por cercanía: se explica en los resultados.
      if (err.code === 1) avisoTemporal(texto);
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
  );
}

/**
 * Al abrir la página se intenta obtener la ubicación, porque es lo que hace
 * útil el ranking por cercanía. Si el permiso ya estaba concedido se resuelve
 * sin preguntar; si estaba denegado no se insiste, para no mostrar un aviso
 * del navegador que el usuario ya rechazó.
 */
async function ubicacionAlArrancar() {
  if (estado.origen || !('geolocation' in navigator)) return;
  try {
    const permiso = await navigator.permissions?.query({ name: 'geolocation' });
    if (permiso?.state === 'denied') {
      estadoUbicacion('Ubicación desactivada. Busca por departamento, provincia y distrito.');
      return;
    }
  } catch { /* sin API de permisos: se pide igual */ }
  pedirGeolocalizacion();
}

function quitarOrigen() {
  estado.origen = null;
  estado.orden = 'nombre';
  el.orden.value = 'nombre';
  el.radioControl.hidden = true;
  el.btnGeoTxt.textContent = 'Usar mi ubicación';
  estadoUbicacion('Activa tu ubicación para ordenar los centros por cercanía.');
  refrescar({ moverMapa: true });
}

/* ============================================================ eventos = */

function conectarEventos() {
  el.dep.addEventListener('change', async () => {
    estado.dep = el.dep.value;
    estado.prov = ''; estado.dist = '';
    llenarProvincias(); llenarDistritos();
    await aplicarTerritorio();
  });

  el.prov.addEventListener('change', async () => {
    estado.prov = el.prov.value;
    estado.dist = '';
    llenarDistritos();
    await aplicarTerritorio();
  });

  el.dist.addEventListener('change', async () => {
    estado.dist = el.dist.value;
    await aplicarTerritorio();
  });

  el.tipo.addEventListener('change', () => {
    estado.tipo = el.tipo.value;
    refrescar();
  });

  let teclado;
  el.q.addEventListener('input', () => {
    clearTimeout(teclado);
    teclado = setTimeout(() => { estado.q = el.q.value; refrescar(); }, 180);
  });

  el.orden.addEventListener('change', () => {
    estado.orden = el.orden.value;
    // Pedir «más cercanos» sin ubicación no puede quedarse en nada: se pide.
    if (estado.orden === 'cercania' && !estado.origen) pedirGeolocalizacion();
    refrescar();
  });

  el.radio.addEventListener('input', () => {
    estado.radioIdx = Number(el.radio.value);
    el.radioValor.textContent = textoRadio();
    refrescar();
  });
  el.radio.addEventListener('change', () => {
    mapa.encuadrarRadio(estado.origen, radioKm());
  });

  el.btnGeo.addEventListener('click', usarMiUbicacion);
  el.btnQuitarUbicacion.addEventListener('click', quitarOrigen);

  /* ruta territorial: volver a cualquier nivel anterior */
  el.migas.addEventListener('click', async (e) => {
    const paso = e.target.closest('[data-ir]');
    if (!paso) return;
    const codigo = paso.dataset.ir;
    estado.dep = codigo.slice(0, 2);
    estado.prov = codigo.length >= 4 ? codigo.slice(0, 4) : '';
    estado.dist = codigo.length === 6 ? codigo : '';
    el.dep.value = estado.dep;
    llenarProvincias();
    llenarDistritos();
    await aplicarTerritorio();
  });

  el.btnLimpiar.addEventListener('click', async () => {
    // Limpiar deja el mapa como al entrar: sin territorio, sin ficha abierta.
    if (!el.ficha.hidden) cerrarFicha(false);
    estado.dep = ''; estado.prov = ''; estado.dist = '';
    estado.tipo = ''; estado.q = '';
    el.q.value = '';
    llenarDepartamentos(); llenarProvincias(); llenarDistritos(); llenarTipos();
    if (estado.origen) quitarOrigen();
    await sincronizarLimites();
    refrescar({ moverMapa: true });
  });

  el.btnTema.addEventListener('click', alternarTema);
  el.btnAyuda.addEventListener('click', abrirAcerca);

  /* lista → ficha, y acciones del estado vacío */
  el.lista.addEventListener('click', (e) => {
    const accion = e.target.closest('[data-accion]');
    if (accion) {
      if (accion.dataset.accion === 'sin-radio') {
        estado.radioIdx = RADIOS.length - 1;          // «sin límite»
        el.radio.value = String(estado.radioIdx);
        el.radioValor.textContent = textoRadio();
        refrescar({ moverMapa: true });
      } else if (accion.dataset.accion === 'limpiar') {
        el.btnLimpiar.click();
      }
      return;
    }
    const btn = e.target.closest('.item');
    if (btn) abrirFicha(Number(btn.dataset.id));
  });

  /* cierres y acciones dentro de la ficha */
  el.ficha.addEventListener('click', (e) => {
    if (e.target.closest('[data-cerrar-ficha]')) { cerrarFicha(); return; }
    if (e.target.closest('[data-accion="ubicar"]')) { pedirGeolocalizacion(); return; }
    const compartir = e.target.closest('[data-accion="compartir"]');
    if (compartir) copiarEnlace(compartir);
  });
  el.acerca.addEventListener('click', (e) => {
    if (e.target.closest('[data-cerrar-acerca]')) cerrarAcerca();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!el.ficha.hidden) cerrarFicha();
    else if (!el.acerca.hidden) cerrarAcerca();
  });

  /* lista / mapa en móvil */
  document.querySelectorAll('.tabbar__btn').forEach((b) => {
    b.addEventListener('click', () => cambiarVista(b.dataset.vista));
  });

  /* el tema del sistema puede cambiar en caliente */
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (!document.documentElement.dataset.tema) mapa.aplicarTema(temaOscuroActivo());
  });
}

function cambiarVista(vista) {
  document.body.dataset.vista = vista;
  document.querySelectorAll('.tabbar__btn').forEach((b) => {
    const activo = b.dataset.vista === vista;
    b.classList.toggle('is-active', activo);
    b.setAttribute('aria-pressed', String(activo));
  });
  if (vista === 'mapa') requestAnimationFrame(() => mapa.invalidar());
}

/* ============================================================= inicio = */

async function iniciar() {
  restaurarTema();
  leerURL();

  try {
    [DIR, ICONOS] = await Promise.all([cargarDirectorio(), cargarIconos()]);
  } catch (err) {
    el.cargando.innerHTML =
      '<div style="text-align:center;max-width:34ch">'
      + '<strong style="display:block;margin-bottom:6px">No se pudo cargar el directorio</strong>'
      + '<span style="font-weight:400;font-size:13px">'
      + 'Comprueba tu conexión y vuelve a intentarlo. Si abriste el archivo directamente '
      + 'desde el disco, necesitas un servidor local.</span></div>';
    console.error(err);
    return;
  }

  mapa = new MapaCentros('mapa', {
    alSeleccionar: abrirFicha,
    alElegirTerritorio: seleccionarTerritorio,
    alPedirUbicacion: usarMiUbicacion,
    alCargarCapa: (cargando) => document.body.classList.toggle('cargando-capa', cargando),
  }, ICONOS);
  mapa.aplicarTema(temaOscuroActivo());

  llenarDepartamentos();
  llenarProvincias();
  llenarDistritos();
  llenarTipos();

  el.q.value = estado.q;
  el.orden.value = estado.orden;
  el.radio.value = String(estado.radioIdx);
  el.radioValor.textContent = textoRadio();
  el.radioControl.hidden = !estado.origen;

  if (estado.origen) {
    el.btnGeoTxt.textContent = 'Actualizar ubicación';
    estadoUbicacion('Ubicación tomada del enlace compartido.', 'is-ok');
    mapa.estadoBotonUbicacion('activa');
  }

  conectarEventos();
  await sincronizarLimites();
  // moverMapa encuadra de entrada: sin esto el mapa arrancaba en el zoom fijo
  // del constructor, más lejos de lo necesario para ver el país entero.
  refrescar({ moverMapa: true });

  el.pieMeta.textContent =
    `${DIR.meta.total} centros de atención físicos · ${DIR.meta.excluidos} servicios `
    + `sin local o sin coordenadas quedan fuera · datos del ${DIR.meta.generado}.`;

  cambiarVista(window.matchMedia('(max-width: 860px)').matches ? 'lista' : 'lista');

  const pendiente = estado.seleccionado;
  estado.seleccionado = null;
  if (pendiente != null) abrirFicha(pendiente);

  el.cargando.classList.add('is-oculto');
  setTimeout(() => { el.cargando.hidden = true; }, 300);

  // Se pide al final para que la interfaz ya esté visible detrás del aviso
  // del navegador y se entienda de dónde sale la petición.
  ubicacionAlArrancar();
}

iniciar();
