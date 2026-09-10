/**
 * Cálculo de distancias y estimación de tiempo de viaje en automóvil.
 *
 * La aplicación es 100 % estática y no usa ningún servicio de rutas, así que
 * el tiempo es necesariamente una ESTIMACIÓN. El modelo que sigue es sencillo
 * pero explícito: distancia en línea recta → distancia por vía (factor de
 * rodeo) → tiempo (velocidad media). Ambos parámetros dependen de la región
 * natural del destino, porque un trayecto de 80 km en la costa y otro de 80 km
 * en la sierra no se parecen en nada.
 */

const R_TIERRA_KM = 6371.0088;
const rad = (g) => (g * Math.PI) / 180;

/** Distancia sobre la superficie terrestre, en kilómetros (Haversine). */
export function distanciaKm(lat1, lon1, lat2, lon2) {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_TIERRA_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Región natural dominante de cada departamento (por código de ubigeo).
 * Varios departamentos son mixtos; se toma la región donde se concentran
 * las vías y la población atendida.
 */
const REGION = {
  '01': 'selva',  // Amazonas
  '02': 'sierra', // Áncash
  '03': 'sierra', // Apurímac
  '04': 'costa',  // Arequipa
  '05': 'sierra', // Ayacucho
  '06': 'sierra', // Cajamarca
  '07': 'costa',  // Callao
  '08': 'sierra', // Cusco
  '09': 'sierra', // Huancavelica
  '10': 'sierra', // Huánuco
  '11': 'costa',  // Ica
  '12': 'sierra', // Junín
  '13': 'costa',  // La Libertad
  '14': 'costa',  // Lambayeque
  '15': 'costa',  // Lima
  '16': 'selva',  // Loreto
  '17': 'selva',  // Madre de Dios
  '18': 'costa',  // Moquegua
  '19': 'sierra', // Pasco
  '20': 'costa',  // Piura
  '21': 'sierra', // Puno
  '22': 'selva',  // San Martín
  '23': 'costa',  // Tacna
  '24': 'costa',  // Tumbes
  '25': 'selva',  // Ucayali
};

/**
 * Factor de rodeo: cuánto más larga es la vía que la línea recta.
 * En la costa la red es reticular y directa; en la sierra las carreteras
 * describen curvas de nivel; en la selva hay pocas vías y muchos rodeos.
 */
const RODEO = { costa: 1.25, sierra: 1.55, selva: 1.60 };

/** Corrección de velocidad por relieve. */
const FACTOR_VELOCIDAD = { costa: 1.0, sierra: 0.70, selva: 0.75 };

/** Velocidad media base (km/h) según la longitud del trayecto por vía. */
function velocidadBase(km) {
  if (km < 3) return 20;    // tráfico urbano denso, semáforos
  if (km < 10) return 26;
  if (km < 30) return 40;
  if (km < 80) return 52;
  if (km < 200) return 62;
  return 68;                // carretera de largo recorrido
}

/**
 * Estima el trayecto en automóvil desde la distancia en línea recta.
 * @param {number} kmLineaRecta
 * @param {string} ccdd  código de departamento del destino
 * @returns {{kmVia:number, minutos:number, region:string, fluvial:boolean}}
 */
export function estimarViaje(kmLineaRecta, ccdd) {
  const region = REGION[ccdd] || 'sierra';
  const kmVia = kmLineaRecta * RODEO[region];
  const velocidad = velocidadBase(kmVia) * FACTOR_VELOCIDAD[region];
  return {
    kmVia,
    minutos: (kmVia / velocidad) * 60,
    region,
    // En la Amazonía buena parte de los destinos lejanos sólo se alcanza por río.
    fluvial: region === 'selva' && kmLineaRecta > 60,
  };
}

/* ----------------------------------------------------------- formatos -- */

export function formatearKm(km) {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(1).replace('.', ',')} km`;
  return `${Math.round(km)} km`;
}

export function formatearMinutos(min) {
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h >= 24) {
    const d = Math.floor(h / 24);
    return `${d} d ${h % 24} h`;
  }
  return r ? `${h} h ${r} min` : `${h} h`;
}

/** URL de indicaciones de Google Maps (funciona en web y en la app móvil). */
export function urlComoLlegar(destino, origen) {
  const u = new URL('https://www.google.com/maps/dir/');
  u.searchParams.set('api', '1');
  u.searchParams.set('destination', `${destino.lat},${destino.lon}`);
  u.searchParams.set('travelmode', 'driving');
  if (origen) u.searchParams.set('origin', `${origen.lat},${origen.lon}`);
  return u.toString();
}

/** URL para ver el punto en Google Maps, sin ruta. */
export function urlVerEnMapa(destino) {
  const u = new URL('https://www.google.com/maps/search/');
  u.searchParams.set('api', '1');
  u.searchParams.set('query', `${destino.lat},${destino.lon}`);
  return u.toString();
}
