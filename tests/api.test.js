import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';

// HTTP real contra un puerto disponible, con reloj y temperatura controlados.
async function entorno(t, options = {}) {
  const server = createApp(options).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  let misionId;
  return async (ruta, method = 'GET', body, usarSesion = true) => {
    const respuesta = await fetch(`http://127.0.0.1:${server.address().port}${ruta}`, {
      method, headers: { 'Content-Type': 'application/json', ...(usarSesion && misionId ? { 'X-Mision-Id': misionId } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const datos = await respuesta.json();
    if (ruta === '/api/mision' && respuesta.ok) misionId = datos.id;
    return { status: respuesta.status, datos };
  };
}

test('reactor: pistas, acierto, validación y reinicio', async (t) => {
  let objetivo = 42;
  const pedir = await entorno(t, { randomTemperature: () => objetivo });
  assert.match((await pedir('/adjust', 'POST', { temperatura: 20 })).datos.mensaje, /más alta/);
  assert.match((await pedir('/adjust', 'POST', { temperatura: 60 })).datos.mensaje, /más baja/);
  assert.equal((await pedir('/adjust', 'POST', { temperatura: 42 })).datos.estabilizado, true);
  for (const temperatura of [0, 101, 1.5, '42', null]) assert.equal((await pedir('/adjust', 'POST', { temperatura })).status, 400);
  objetivo = 80;
  await pedir('/reboot', 'POST');
  assert.equal((await pedir('/adjust', 'POST', { temperatura: 42 })).datos.estabilizado, false);
  assert.equal((await pedir('/adjust', 'POST', { temperatura: 80 })).datos.estabilizado, true);
});

test('carga: reservar, aumentar, reducir, eliminar y rechazar sin cambios parciales', async (t) => {
  const pedir = await entorno(t);
  assert.equal((await pedir('/api/carga')).status, 401);
  assert.equal((await pedir('/api/mision', 'POST')).status, 201);
  let r = await pedir('/api/carga/agregar', 'POST', { equipoId: 201, cantidad: 2 });
  assert.equal(r.datos.creditos, 400);
  assert.equal((await pedir('/api/inventario')).datos[0].stock, 3);
  r = await pedir('/api/carga/actualizar-unidades/201', 'PUT', { cantidad: 4 });
  assert.equal(r.datos.total, 200);
  await pedir('/api/carga/actualizar-unidades/201', 'PUT', { cantidad: 1 });
  assert.equal((await pedir('/api/inventario')).datos[0].stock, 4);
  r = await pedir('/api/carga/agregar', 'POST', { equipoId: 201, cantidad: 5 });
  assert.equal(r.status, 400); assert.equal(r.datos.mensaje, 'Stock en base insuficiente');
  await pedir('/api/carga/agregar', 'POST', { equipoId: 206, cantidad: 2 });
  r = await pedir('/api/carga/actualizar-unidades/201', 'PUT', { cantidad: 5 });
  assert.equal(r.status, 400); assert.equal(r.datos.mensaje, 'Créditos insuficientes para esta cantidad');
  assert.equal((await pedir('/api/carga')).datos.total, 350);
  assert.equal((await pedir('/api/inventario')).datos[0].stock, 4);
  await pedir('/api/carga/eliminar/201', 'DELETE');
  assert.equal((await pedir('/api/inventario')).datos[0].stock, 5);
  assert.equal((await pedir('/api/carga')).datos.total, 300);
  for (const cantidad of [-1, 0, 1.2, '2']) assert.equal((await pedir('/api/carga/agregar', 'POST', { equipoId: 202, cantidad })).status, 400);
  assert.equal((await pedir('/api/carga/eliminar/999', 'DELETE')).status, 404);
});

test('confirmación: exige carga y bloquea modificaciones conservando el stock', async (t) => {
  const pedir = await entorno(t);
  await pedir('/api/mision', 'POST');
  assert.equal((await pedir('/api/carga/confirmar', 'POST')).status, 400);
  await pedir('/api/carga/agregar', 'POST', { equipoId: 201, cantidad: 1 });
  assert.equal((await pedir('/api/carga/confirmar', 'POST')).datos.estado, 'confirmada');
  assert.equal((await pedir('/api/carga/eliminar/201', 'DELETE')).status, 409);
  await pedir('/api/mision', 'POST');
  assert.equal((await pedir('/api/inventario')).datos[0].stock, 4);
});

test('caducidad: el servidor cierra la sesión y libera reservas una sola vez', async (t) => {
  let tiempo = 1000;
  const pedir = await entorno(t, { now: () => tiempo, durationMs: 5000 });
  await pedir('/api/mision', 'POST');
  await pedir('/api/carga/agregar', 'POST', { equipoId: 201, cantidad: 3 });
  tiempo = 6000;
  assert.equal((await pedir('/api/carga/agregar', 'POST', { equipoId: 202, cantidad: 1 })).status, 410);
  assert.equal((await pedir('/api/carga')).status, 410);
  assert.equal((await pedir('/api/inventario')).datos[0].stock, 5);
  await pedir('/api/mision', 'POST');
  assert.equal((await pedir('/api/carga')).datos.creditos, 500);
});

test('dos capitanes comparten stock sin compartir carga; reiniciar devuelve reservas', async (t) => {
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  const call = async (ruta, method, id, body) => {
    const r = await fetch(url + ruta, { method, headers: { 'Content-Type': 'application/json', ...(id ? { 'X-Mision-Id': id } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, datos: await r.json() };
  };
  const a = (await call('/api/mision', 'POST')).datos.id;
  const b = (await call('/api/mision', 'POST')).datos.id;
  const resultados = await Promise.all([call('/api/carga/agregar', 'POST', a, { equipoId: 201, cantidad: 4 }), call('/api/carga/agregar', 'POST', b, { equipoId: 201, cantidad: 4 })]);
  assert.deepEqual(resultados.map((r) => r.status).sort(), [200, 400]);
  const ganador = resultados[0].status === 200 ? a : b;
  await call('/api/mision', 'POST', ganador);
  assert.equal((await call('/api/inventario', 'GET')).datos[0].stock, 5);
});
