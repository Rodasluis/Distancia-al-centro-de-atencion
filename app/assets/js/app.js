/**
 * Orquestación: estado, filtros, sincronización entre lista, mapa y ficha,
 * y persistencia del estado en la URL para poder compartir una búsqueda.
 */

import { cargarDirectorio, filtrar, tienePuntoExacto } from './datos.js';
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
  btnPin: $('#btn-pin'),
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
  leyenda: $('#leyenda'),
  pieMeta: $('#pie-meta'),
};

const estado = {
  origen: null,          // {lat, lon, fuente}
  radioIdx: RADIO_POR_DEFECTO,
  dep: '', prov: '', dist: '', tipo: '', q: '',
  orden: 'nombre',
  seleccionado: null,
  capa: 'departamentos',
};

let DIR = null;
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
  if (p.has('capa')) estado.capa = p.get('capa');
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
    if (estado.capa !== 'departamentos') p.set('capa', estado.capa);
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
  const { lista, fueraDeRadio, sinPunto, totalTerritorial } = filtrar(DIR.centros, {
    origen: estado.origen,
    radioKm: radioKm(),
    dep: estado.dep,
    prov: estado.prov,
    dist: estado.dist,
    tipo: estado.tipo,
    q: estado.q,
    orden: estado.orden,
  });
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
  if (estado.origen && sinPunto > 0) {
    notas.push(sinPunto === 1
      ? '1 servicio no entra en el ranking por cercanía: se atiende por teléfono '
        + 'o su dirección es reservada.'
      : `${sinPunto} servicios no entran en el ranking por cercanía: se atienden `
        + 'por teléfono o su dirección es reservada.');
  }
  if (notas.length) notas.push('Quita tu ubicación para verlos todos.');
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
    mensajeVacio,
    accionVacio,
  });
  mapa.dibujarCentros(lista);
  mapa.dibujarOrigen(estado.origen, radioKm());
  if (estado.seleccionado != null) mapa.resaltar(estado.seleccionado, false);

  if (moverMapa) {
    if (estado.origen) mapa.encuadrarRadio(estado.origen, radioKm());
    else if (estado.dist) mapa.encuadrarTerritorio('distritos', estado.dist);
    else if (estado.prov) mapa.encuadrarTerritorio('provincias', estado.prov);
    else if (estado.dep) mapa.encuadrarTerritorio('departamentos', estado.dep);
    else mapa.encuadrarCentros(lista);
  }

  escribirURL();
}

/** Elige la capa de límites más informativa según el filtro territorial. */
async function sincronizarLimites() {
  const ccdd = estado.dep || null;
  let nivel = estado.capa;
  // Provincias y distritos sólo existen por departamento.
  if ((nivel === 'provincias' || nivel === 'distritos') && !ccdd) nivel = 'departamentos';
  await mapa.mostrarLimites(nivel, ccdd);
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

function cerrarFicha() {
  el.ficha.hidden = true;
  estado.seleccionado = null;
  mapa.limpiarResaltado();
  el.lista.querySelectorAll('.item.is-activo').forEach((b) => b.classList.remove('is-activo'));
  ultimoFoco?.focus?.();
  escribirURL();
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

function pedirGeolocalizacion() {
  if (!('geolocation' in navigator)) {
    estadoUbicacion('Tu navegador no permite geolocalización. Usa «Elegir en el mapa».', 'is-error');
    return;
  }
  el.btnGeo.disabled = true;
  estadoUbicacion('Obteniendo tu ubicación…');

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      el.btnGeo.disabled = false;
      const { latitude, longitude, accuracy } = pos.coords;
      const precision = accuracy ? ` (precisión ≈ ${Math.round(accuracy)} m)` : '';
      fijarOrigen({ lat: latitude, lon: longitude, fuente: 'gps' },
        `Ubicación detectada${precision}.`);
    },
    (err) => {
      el.btnGeo.disabled = false;
      const motivos = {
        1: 'Permiso denegado. Puedes marcar tu posición con «Elegir en el mapa».',
        2: 'No se pudo determinar tu posición. Inténtalo de nuevo o usa «Elegir en el mapa».',
        3: 'La búsqueda de ubicación tardó demasiado. Inténtalo de nuevo.',
      };
      estadoUbicacion(motivos[err.code] || 'No se pudo obtener tu ubicación.', 'is-error');
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
  );
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
    await sincronizarLimites();
    refrescar({ moverMapa: true });
  });

  el.prov.addEventListener('change', async () => {
    estado.prov = el.prov.value;
    estado.dist = '';
    llenarDistritos();
    await sincronizarLimites();
    refrescar({ moverMapa: true });
  });

  el.dist.addEventListener('change', () => {
    estado.dist = el.dist.value;
    refrescar({ moverMapa: true });
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
    if (estado.orden === 'cercania' && !estado.origen) {
      estadoUbicacion('Necesitas activar tu ubicación para ordenar por cercanía.', 'is-error');
    }
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

  el.btnGeo.addEventListener('click', pedirGeolocalizacion);

  el.btnPin.addEventListener('click', () => {
    const activo = el.btnPin.getAttribute('aria-pressed') === 'true';
    mapa.activarModoPin(!activo);
    if (!activo) {
      estadoUbicacion('Toca el mapa para marcar tu punto de partida.');
      if (window.matchMedia('(max-width: 860px)').matches) cambiarVista('mapa');
    }
  });

  el.btnLimpiar.addEventListener('click', async () => {
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

  /* cierres */
  el.ficha.addEventListener('click', (e) => {
    if (e.target.closest('[data-cerrar-ficha]')) cerrarFicha();
  });
  el.acerca.addEventListener('click', (e) => {
    if (e.target.closest('[data-cerrar-acerca]')) cerrarAcerca();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!el.ficha.hidden) cerrarFicha();
    else if (!el.acerca.hidden) cerrarAcerca();
    else if (mapa.modoPin) { mapa.activarModoPin(false); estadoUbicacion('Selección cancelada.'); }
  });

  /* capas del mapa */
  el.leyenda.querySelector('.leyenda__toggle').addEventListener('click', (e) => {
    const cuerpo = el.leyenda.querySelector('.leyenda__cuerpo');
    const abierto = e.currentTarget.getAttribute('aria-expanded') === 'true';
    e.currentTarget.setAttribute('aria-expanded', String(!abierto));
    cuerpo.hidden = abierto;
  });
  el.leyenda.querySelectorAll('input[name="capa"]').forEach((r) => {
    r.addEventListener('change', async () => {
      estado.capa = r.value;
      await sincronizarLimites();
      escribirURL();
    });
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
    DIR = await cargarDirectorio();
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
    alElegirPunto: (p) => fijarOrigen({ ...p, fuente: 'mapa' }, 'Punto marcado en el mapa.'),
    alCambiarModoPin: (activo) => el.btnPin.setAttribute('aria-pressed', String(activo)),
  });
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
  const radioCapa = el.leyenda.querySelector(`input[name="capa"][value="${estado.capa}"]`);
  if (radioCapa) radioCapa.checked = true;

  if (estado.origen) {
    el.btnGeoTxt.textContent = 'Actualizar ubicación';
    estadoUbicacion('Ubicación tomada del enlace compartido.', 'is-ok');
  }

  conectarEventos();
  await sincronizarLimites();
  refrescar({ moverMapa: true });

  el.leyenda.hidden = false;
  el.pieMeta.textContent =
    `${DIR.meta.total} servicios · datos actualizados el ${DIR.meta.generado}.`;

  cambiarVista(window.matchMedia('(max-width: 860px)').matches ? 'lista' : 'lista');

  const pendiente = estado.seleccionado;
  estado.seleccionado = null;
  if (pendiente != null) abrirFicha(pendiente);

  el.cargando.classList.add('is-oculto');
  setTimeout(() => { el.cargando.hidden = true; }, 300);
}

iniciar();
