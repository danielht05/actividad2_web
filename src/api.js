// fetch devuelve una promesa. Centralizamos los errores para que cada panel los muestre.
export async function api(ruta, method = 'GET', datos) {
  const id = sessionStorage.getItem('misionId');
  const respuesta = await fetch(ruta, {
    method,
    headers: { 'Content-Type': 'application/json', ...(id ? { 'X-Mision-Id': id } : {}) },
    ...(datos !== undefined ? { body: JSON.stringify(datos) } : {}),
  });
  const resultado = await respuesta.json();
  if (!respuesta.ok) {
    const error = new Error(resultado.mensaje || 'No se pudo completar la petición.');
    error.status = respuesta.status;
    throw error;
  }
  return resultado;
}
