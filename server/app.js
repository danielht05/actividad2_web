import express from 'express';
import { randomUUID, randomInt } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const catalogoInicial = [
  { id: 201, nombre: 'Tanque de Oxígeno XL', precio: 50, stock: 5, categoria: 'Soporte Vital' },
  { id: 202, nombre: 'Raciones de exploración', precio: 25, stock: 8, categoria: 'Alimentación' },
  { id: 203, nombre: 'Kit médico orbital', precio: 75, stock: 3, categoria: 'Salud' },
  { id: 204, nombre: 'Batería de alto rendimiento', precio: 100, stock: 4, categoria: 'Energía' },
  { id: 205, nombre: 'Herramientas de reparación', precio: 60, stock: 3, categoria: 'Ingeniería' },
  { id: 206, nombre: 'Sonda de reconocimiento', precio: 150, stock: 2, categoria: 'Exploración' },
];

// Cada instancia tiene su propio estado: permite probar sin alterar el servidor real.
export function createApp({ now = Date.now, durationMs = 180_000, randomTemperature = () => randomInt(1, 101) } = {}) {
  const app = express();
  const inventario = structuredClone(catalogoInicial);
  const misiones = new Map();
  let temperaturaIdeal = randomTemperature();
  app.use(express.json({ limit: '10kb' }));

  const fallo = (res, mensaje, status = 400) => res.status(status).json({ mensaje });
  const total = (mision) => mision.itemsCargados.reduce((suma, item) => {
    const equipo = inventario.find((e) => e.id === item.id);
    return suma + equipo.precio * item.cantidad;
  }, 0);
  const detalle = (mision) => ({
    id: mision.id, presupuesto: 500, creditos: 500 - total(mision),
    itemsCargados: mision.itemsCargados, total: total(mision),
    venceEn: mision.venceEn, servidorAhora: now(), estado: mision.estado,
  });
  function liberar(mision) {
    for (const item of mision.itemsCargados) {
      inventario.find((e) => e.id === item.id).stock += item.cantidad;
    }
    mision.itemsCargados = [];
  }
  // La caducidad se verifica antes de cada petición, incluso si se manipuló el reloj del navegador.
  app.use('/api', (req, res, next) => {
    for (const mision of misiones.values()) {
      if (mision.estado === 'activa' && now() >= mision.venceEn) {
        liberar(mision);
        mision.estado = 'expirada';
      }
      if (mision.estado !== 'activa' && now() > mision.venceEn + 3_600_000) misiones.delete(mision.id);
    }
    next();
  });
  function obtenerMision(req, res, next) {
    const mision = misiones.get(req.get('X-Mision-Id'));
    if (!mision) return fallo(res, 'Inicia una nueva misión para continuar.', 401);
    if (mision.estado === 'expirada') return fallo(res, 'La ventana de lanzamiento terminó. Inicia una nueva misión.', 410);
    req.mision = mision;
    next();
  }
  function editable(req, res, next) {
    if (req.mision.estado !== 'activa') return fallo(res, 'La carga ya fue confirmada.', 409);
    next();
  }
  function cambiarCantidad(mision, equipo, nuevaCantidad, res) {
    const item = mision.itemsCargados.find((i) => i.id === equipo.id);
    const anterior = item?.cantidad ?? 0;
    const diferencia = nuevaCantidad - anterior;
    if (diferencia > equipo.stock) return fallo(res, 'Stock en base insuficiente');
    if (total(mision) + diferencia * equipo.precio > 500) return fallo(res, 'Créditos insuficientes para esta cantidad');
    // Validamos TODO antes de modificar: un error no puede dejar cambios parciales.
    equipo.stock -= diferencia;
    if (item) item.cantidad = nuevaCantidad;
    else mision.itemsCargados.push({ id: equipo.id, cantidad: nuevaCantidad });
    return res.json(detalle(mision));
  }

  app.post('/adjust', (req, res) => {
    const temperatura = req.body?.temperatura;
    if (!Number.isInteger(temperatura) || temperatura < 1 || temperatura > 100) {
      return fallo(res, 'Ingresa una temperatura entera entre 1 y 100.');
    }
    const estabilizado = temperatura === temperaturaIdeal;
    const mensaje = estabilizado ? 'Reactor estabilizado' : temperatura < temperaturaIdeal ? 'La temperatura ideal es más alta' : 'La temperatura ideal es más baja';
    res.json({ mensaje, estabilizado });
  });
  app.post('/reboot', (req, res) => {
    temperaturaIdeal = randomTemperature();
    res.json({ mensaje: 'Sistema reiniciado. Prueba una nueva temperatura.', estabilizado: false });
  });
  app.post('/api/mision', (req, res) => {
    const anterior = misiones.get(req.get('X-Mision-Id'));
    if (anterior?.estado === 'activa') { liberar(anterior); anterior.estado = 'cancelada'; }
    const mision = { id: randomUUID(), itemsCargados: [], venceEn: now() + durationMs, estado: 'activa' };
    misiones.set(mision.id, mision);
    res.status(201).json(detalle(mision));
  });
  app.get('/api/inventario', (req, res) => res.json(inventario));
  app.get('/api/carga', obtenerMision, (req, res) => res.json(detalle(req.mision)));
  app.post('/api/carga/agregar', obtenerMision, editable, (req, res) => {
    const { equipoId, cantidad } = req.body ?? {};
    if (!Number.isInteger(equipoId) || !Number.isInteger(cantidad) || cantidad < 1) return fallo(res, 'Equipo y cantidad deben ser enteros positivos.');
    const equipo = inventario.find((e) => e.id === equipoId);
    if (!equipo) return fallo(res, 'Suministro no encontrado.', 404);
    const anterior = req.mision.itemsCargados.find((i) => i.id === equipoId)?.cantidad ?? 0;
    return cambiarCantidad(req.mision, equipo, anterior + cantidad, res);
  });
  app.put('/api/carga/actualizar-unidades/:id', obtenerMision, editable, (req, res) => {
    const cantidad = req.body?.cantidad;
    if (!Number.isInteger(cantidad) || cantidad < 1) return fallo(res, 'La cantidad debe ser un entero mayor que cero. Usa Desembarcar para eliminar.');
    const equipo = inventario.find((e) => e.id === Number(req.params.id));
    if (!equipo || !req.mision.itemsCargados.some((i) => i.id === equipo.id)) return fallo(res, 'Suministro no encontrado en la carga.', 404);
    return cambiarCantidad(req.mision, equipo, cantidad, res);
  });
  app.delete('/api/carga/eliminar/:id', obtenerMision, editable, (req, res) => {
    const item = req.mision.itemsCargados.find((i) => i.id === Number(req.params.id));
    if (!item) return fallo(res, 'Suministro no encontrado en la carga.', 404);
    inventario.find((e) => e.id === item.id).stock += item.cantidad;
    req.mision.itemsCargados = req.mision.itemsCargados.filter((i) => i.id !== item.id);
    res.json(detalle(req.mision));
  });
  app.post('/api/carga/confirmar', obtenerMision, editable, (req, res) => {
    if (!req.mision.itemsCargados.length) return fallo(res, 'Agrega al menos un suministro antes de confirmar.');
    req.mision.estado = 'confirmada';
    res.json(detalle(req.mision));
  });
  app.use('/api', (req, res) => fallo(res, 'Ruta de API no encontrada.', 404));
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
  app.use(express.static(root));
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return fallo(res, 'El cuerpo debe ser JSON válido.');
    if (err.type === 'entity.too.large') return fallo(res, 'La solicitud es demasiado grande.', 413);
    console.error(err);
    return fallo(res, 'Ocurrió un error interno.', 500);
  });
  return app;
}
