/**
 * Construcción del listado de resultados y de la ficha detallada.
 */

import { formatearKm, formatearMinutos, urlComoLlegar, urlVerEnMapa } from './geo.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ICONOS = {
  pin: '<path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z"/>',
  auto: '<path d="M5 11l1.5-4.5h11L19 11m-1.5 4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3m-11 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3M18.9 6A1.5 1.5 0 0 0 17.5 5h-11A1.5 1.5 0 0 0 5.1 6L3 12v8a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-1h12v1a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-8l-2.1-6Z"/>',
  tel: '<path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.24 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.46.57 3.6a1 1 0 0 1-.25 1Z"/>',
  persona: '<path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2c-4.4 0-8 2.24-8 5v3h16v-3c0-2.76-3.6-5-8-5Z"/>',
  casa: '<path d="M12 3 2 12h3v9h6v-6h2v6h6v-9h3L12 3Z"/>',
  etiqueta: '<path d="M10 3H4a1 1 0 0 0-1 1v6l10.5 10.5a1 1 0 0 0 1.4 0l6.6-6.6a1 1 0 0 0 0-1.4L11 3Zm-3.5 5A1.5 1.5 0 1 1 8 6.5 1.5 1.5 0 0 1 6.5 8Z"/>',
  aviso: '<path d="M12 2 1 21h22L12 2Zm1 14h-2v2h2v-2Zm0-6h-2v5h2v-5Z"/>',
  reloj: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 10.6 4 2.3-.75 1.3L11.5 13.4V6.5h1.5v6.1Z"/>',
};

const svg = (d, tam = 14) =>
  `<svg viewBox="0 0 24 24" width="${tam}" height="${tam}" aria-hidden="true" fill="currentColor">${d}</svg>`;

/* ------------------------------------------------------------ listado -- */

/**
 * Pinta el listado de resultados.
 * @param {HTMLElement} contenedor
 * @param {Array} centros  con _km y _viaje si hay origen
 * @param {{hayOrigen:boolean, ordenCercania:boolean, seleccionado:number|null}} opciones
 */
export function pintarLista(contenedor, centros, opciones) {
  if (!centros.length) {
    contenedor.innerHTML = `
      <li class="vacio">
        <strong>Sin resultados</strong>
        ${esc(opciones.mensajeVacio || 'Prueba a ampliar el radio de búsqueda o a quitar algún filtro.')}
        ${opciones.accionVacio
          ? `<button class="btn btn--ghost" style="margin-top:12px" type="button"
                     data-accion="${esc(opciones.accionVacio.accion)}">${esc(opciones.accionVacio.texto)}</button>`
          : ''}
      </li>`;
    return;
  }

  const conRanking = opciones.hayOrigen && opciones.ordenCercania;
  const frag = document.createDocumentFragment();

  centros.forEach((c, i) => {
    const li = document.createElement('li');
    const rank = conRanking ? i + 1 : null;

    const metricas = [];
    if (c._km != null) {
      metricas.push(`<span class="metrica metrica--dist">${svg(ICONOS.pin, 13)} ${esc(formatearKm(c._km))}</span>`);
      metricas.push(`<span class="metrica">${svg(ICONOS.auto, 13)} ${esc(formatearMinutos(c._viaje.minutos))}</span>`);
    }
    if (c.vraem) metricas.push('<span class="badge badge--vraem">VRAEM</span>');

    // Con ranking se muestra el número; sin él, el icono del tipo de centro.
    const marca = opciones.marcaDe?.(c.tipo);
    const insignia = rank !== null
      ? `<span class="item__rank" aria-hidden="true">${rank}</span>`
      : `<span class="item__rank item__rank--icono" aria-hidden="true"
               style="--pin-color:${marca?.color || 'var(--mimp)'}">${marca?.html || svg(ICONOS.pin, 13)}</span>`;

    li.innerHTML = `
      <button class="item${rank && rank <= 3 ? ' is-top' : ''}${c.id === opciones.seleccionado ? ' is-activo' : ''}"
              type="button" data-id="${c.id}">
        ${insignia}
        <span class="item__cuerpo">
          <span class="item__tipo">${esc(c.tipo)}</span>
          <span class="item__nombre">${esc(c.nombre)}</span>
          <span class="item__lugar">${esc(c.dist)} · ${esc(c.prov)}, ${esc(c.dep)}</span>
          ${metricas.length ? `<span class="item__metricas">${metricas.join('')}</span>` : ''}
        </span>
      </button>`;
    frag.appendChild(li);
  });

  contenedor.replaceChildren(frag);
}

/* -------------------------------------------------------------- ficha -- */

const AVISOS_CALIDAD = {
  otro_distrito:
    'Las coordenadas registradas caen fuera del distrito declarado en el directorio. '
    + 'La ubicación del mapa puede ser aproximada: confirma por teléfono antes de desplazarte.',
  referencial:
    'Las coordenadas registradas no coinciden con ningún distrito del país; se muestran tal cual. '
    + 'Confirma la dirección por teléfono antes de desplazarte.',
};

const ETIQUETAS_EQUIP = {
  telefono: 'Teléfono', internet: 'Internet', luz: 'Luz', agua: 'Agua', desague: 'Desagüe',
};

/** Devuelve el HTML del cuerpo y del pie de la ficha de un centro. */
export function construirFicha(c, origen) {
  const dato = (icono, etiqueta, valor) => `
    <div class="dato">
      <span class="dato__icono">${svg(icono, 16)}</span>
      <span>
        <span class="dato__et">${esc(etiqueta)}</span>
        <span class="dato__val">${valor}</span>
      </span>
    </div>`;

  /* resumen de distancia / tiempo */
  let resumen = '';
  if (c._km != null) {
    const v = c._viaje;
    resumen = `
      <dl class="resumen">
        <div class="resumen__dato">
          <dt>Distancia</dt><dd>${esc(formatearKm(c._km))}</dd>
        </div>
        <div class="resumen__dato">
          <dt>En auto (est.)</dt><dd>${esc(formatearMinutos(v.minutos))}</dd>
        </div>
        <div class="resumen__dato">
          <dt>Recorrido aprox.</dt><dd>${esc(formatearKm(v.kmVia))}</dd>
        </div>
      </dl>`;
  }

  /* avisos */
  const avisos = [];
  if (AVISOS_CALIDAD[c.calidad]) avisos.push(AVISOS_CALIDAD[c.calidad]);
  if (c._viaje?.fluvial) {
    avisos.push('En esta zona de la Amazonía puede no existir vía carrozable: '
      + 'el acceso suele ser fluvial y el tiempo real será mayor que el estimado.');
  }
  const htmlAvisos = avisos.map((t) =>
    `<p class="nota">${svg(ICONOS.aviso, 15)}<span>${esc(t)}</span></p>`).join('');

  /* contacto */
  const contacto = [];
  if (c.responsable) contacto.push(dato(ICONOS.persona, 'Responsable', esc(c.responsable)));
  if (c.telefono) {
    const tel = c.telefono.replace(/[^\d+]/g, '');
    contacto.push(dato(ICONOS.tel, 'Teléfono',
      `<a href="tel:${esc(tel)}">${esc(c.telefono)}</a>`));
  }
  if (!contacto.length) {
    contacto.push(dato(ICONOS.tel, 'Contacto',
      '<span style="color:var(--tinta-3)">No registrado en el directorio</span>'));
  }

  /* Servicios básicos del local. Se declaran también los no registrados:
     mostrar sólo los conocidos daría a entender que el resto no existe. */
  const conocidos = Object.entries(c.equip).filter(([, v]) => v !== null);
  const desconocidos = Object.entries(c.equip).filter(([, v]) => v === null).map(([k]) => ETIQUETAS_EQUIP[k]);
  const equip = conocidos
    .map(([k, v]) => `<span class="chip chip--${v ? 'si' : 'no'}">${v ? '✓' : '✕'} ${esc(ETIQUETAS_EQUIP[k])}</span>`)
    .join('');
  const equipNota = desconocidos.length
    ? `<p class="hint" style="margin-top:7px">Sin dato registrado sobre: ${esc(desconocidos.join(', ').toLowerCase())}.</p>`
    : '';

  const cuerpo = `
    ${resumen}
    ${htmlAvisos}

    <section class="bloque">
      <h3 class="bloque__titulo">Ubicación</h3>
      <div class="datos">
        ${dato(ICONOS.casa, 'Dirección', esc(c.direccion))}
        ${dato(ICONOS.pin, 'Distrito, provincia y departamento',
          `${esc(c.dist)} · ${esc(c.prov)}, ${esc(c.dep)}`)}
        ${c.ambito && c.ambito !== c.dep
          ? dato(ICONOS.etiqueta, 'Ámbito administrativo MIMP', esc(c.ambito)) : ''}
      </div>
    </section>

    <section class="bloque">
      <h3 class="bloque__titulo">Contacto</h3>
      <div class="datos">${contacto.join('')}</div>
    </section>

    <section class="bloque">
      <h3 class="bloque__titulo">Sobre el servicio</h3>
      <div class="datos">
        ${dato(ICONOS.etiqueta, 'Servicio que presta', esc(c.servicio))}
        ${c.modalidad ? dato(ICONOS.etiqueta, 'Modalidad', esc(c.modalidad)) : ''}
        ${c.vraem ? dato(ICONOS.aviso, 'Ámbito', 'Zona VRAEM') : ''}
      </div>
    </section>

    ${equip ? `
    <section class="bloque">
      <h3 class="bloque__titulo">Servicios básicos del local</h3>
      <div class="chips">${equip}</div>
      ${equipNota}
    </section>` : ''}

    <section class="bloque">
      <h3 class="bloque__titulo">Identificación</h3>
      <div class="datos">
        ${c.codigo ? dato(ICONOS.etiqueta, 'Código del centro', esc(c.codigo)) : ''}
        ${dato(ICONOS.etiqueta, 'Ubigeo', esc(c.ubigeo))}
        ${dato(ICONOS.pin, 'Coordenadas',
          `${c.lat.toFixed(5)}, ${c.lon.toFixed(5)}`)}
      </div>
    </section>`;

  const enlaceTel = c.telefono
    ? `tel:${esc(c.telefono.replace(/[^\d+]/g, ''))}`
    : null;

  const pie = `
    <a class="btn btn--primary" href="${esc(urlComoLlegar(c, origen))}" target="_blank" rel="noopener">
      ${svg(ICONOS.auto, 15)} Cómo llegar
    </a>
    ${enlaceTel
      ? `<a class="btn btn--ghost" href="${enlaceTel}">${svg(ICONOS.tel, 15)} Llamar</a>`
      : `<a class="btn btn--ghost" href="${esc(urlVerEnMapa(c))}" target="_blank" rel="noopener">${svg(ICONOS.pin, 15)} Ver en Google Maps</a>`}`;

  return { cuerpo, pie };
}
