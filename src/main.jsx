import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Alert, Badge, Button, ButtonGroup, Card, CardBody, Col, Container, Form, Input, Label, ListGroup, ListGroupItem, Row, UncontrolledAlert } from 'reactstrap';
import 'bootstrap/dist/css/bootstrap.min.css';
import './styles.css';
import { api } from './api.js';

const creditos = (numero) => new Intl.NumberFormat('es-SV', { maximumFractionDigits: 2 }).format(numero);

function Reactor() {
  const [temperatura, setTemperatura] = useState('');
  const [historial, setHistorial] = useState([]);
  const [mensaje, setMensaje] = useState('Elige una temperatura entre 1 y 100 para comenzar.');
  const [estabilizado, setEstabilizado] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');

  async function ajustar(evento) {
    evento.preventDefault();
    setOcupado(true); setError('');
    try {
      const valor = Number(temperatura);
      const resultado = await api('/adjust', 'POST', { temperatura: valor });
      setMensaje(resultado.mensaje);
      setEstabilizado(resultado.estabilizado);
      // Guardamos todos los intentos, incluido el correcto; los fallidos quedan identificados.
      setHistorial((anterior) => [...anterior, { temperatura: valor, ...resultado }]);
      setTemperatura('');
    } catch (err) { setError(err.message); }
    finally { setOcupado(false); }
  }
  async function reiniciar() {
    setOcupado(true); setError('');
    try {
      const resultado = await api('/reboot', 'POST');
      setHistorial([]); setTemperatura(''); setEstabilizado(false); setMensaje(resultado.mensaje);
    } catch (err) { setError(err.message); }
    finally { setOcupado(false); }
  }
  return <Row className="g-4">
    <Col lg="7"><Card><CardBody className="p-4 p-md-5">
      <span className="eyebrow">EJERCICIO 01 / SISTEMA TÉRMICO</span>
      <h2 className="mt-3">Estabiliza el reactor</h2>
      <p className="text-secondary">Encuentra la temperatura ideal. El centro de control te indicará en qué dirección ajustar.</p>
      <div className={`reactor-visual ${estabilizado ? 'stable' : ''}`} aria-hidden="true"><div>{estabilizado ? '✓' : '°C'}</div></div>
      {error && <Alert color="danger" role="alert">{error}</Alert>}
      <Alert color={estabilizado ? 'success' : 'info'} aria-live="polite">{mensaje}</Alert>
      <Form onSubmit={ajustar}>
        <Label for="temperatura">Temperatura de ajuste (1–100)</Label>
        <div className="d-flex gap-2"><Input id="temperatura" type="number" min="1" max="100" step="1" required value={temperatura} onChange={(e) => setTemperatura(e.target.value)} disabled={ocupado || estabilizado} placeholder="Ej. 50" />
          <Button color="primary" disabled={ocupado || estabilizado} type="submit">{ocupado ? 'Procesando…' : 'Ajustar'}</Button></div>
      </Form>
      <Button className="mt-3" color="secondary" outline onClick={reiniciar} disabled={ocupado}>Reiniciar reactor</Button>
    </CardBody></Card></Col>
    <Col lg="5"><Card><CardBody className="p-4"><div className="d-flex justify-content-between"><h3>Registro de ajustes</h3><Badge color="dark" pill>{historial.length}</Badge></div>
      <p className="text-secondary">Intentos de la sesión actual.</p>
      {!historial.length ? <p className="empty-state">Aún no hay ajustes registrados.</p> : <ListGroup>{historial.map((intento, indice) => <ListGroupItem key={indice} className="d-flex gap-3"><strong className="temperature">{intento.temperatura}°</strong><div><small className="text-secondary">INTENTO {indice + 1}</small><div>{intento.mensaje}</div></div></ListGroupItem>)}</ListGroup>}
    </CardBody></Card></Col>
  </Row>;
}

function Logistica() {
  const [inventario, setInventario] = useState([]);
  const [carga, setCarga] = useState(null);
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(true);
  const [restante, setRestante] = useState(0);
  const [desfase, setDesfase] = useState(0);

  function guardarCarga(datos) {
    setCarga(datos);
    setDesfase(datos.servidorAhora - Date.now());
    setRestante(Math.max(0, Math.ceil((datos.venceEn - datos.servidorAhora) / 1000)));
  }
  function mostrarError(err) {
    setError(err.message);
    if (err.status === 410 || err.status === 401) {
      setCarga((anterior) => anterior ? { ...anterior, estado: 'expirada' } : null);
      sessionStorage.removeItem('misionId');
    }
  }
  useEffect(() => {
    let vigente = true;
    async function cargar() {
      try {
        const productos = await api('/api/inventario');
        if (!vigente) return;
        setInventario(productos);
        if (sessionStorage.getItem('misionId')) {
          const datos = await api('/api/carga');
          if (vigente) guardarCarga(datos);
        }
      } catch (err) { if (vigente) mostrarError(err); }
      finally { if (vigente) setOcupado(false); }
    }
    cargar();
    return () => { vigente = false; };
  }, []);

  useEffect(() => {
    if (carga?.estado !== 'activa') return;
    const timer = setInterval(() => {
      setRestante(Math.max(0, Math.ceil((carga.venceEn - Date.now() - desfase) / 1000)));
    }, 1000);
    return () => clearInterval(timer);
  }, [carga?.venceEn, carga?.estado, desfase]);

  useEffect(() => {
    if (carga?.estado !== 'activa' || restante > 0) return;
    // Pedimos al servidor que confirme la expiración y libere las reservas.
    api('/api/carga').then(guardarCarga).catch(mostrarError);
  }, [restante, carga?.estado]);

  async function operar(ruta, metodo, datos, nuevaMision = false) {
    setOcupado(true); setError('');
    try {
      const resultado = await api(ruta, metodo, datos);
      if (nuevaMision) sessionStorage.setItem('misionId', resultado.id);
      guardarCarga(resultado);
      setInventario(await api('/api/inventario'));
    } catch (err) {
      mostrarError(err);
      try { setInventario(await api('/api/inventario')); } catch { /* Conservamos el mensaje original. */ }
    } finally { setOcupado(false); }
  }
  const activa = carga?.estado === 'activa' && restante > 0;
  const minutos = `${Math.floor(restante / 60)}`.padStart(2, '0');
  const segundos = `${restante % 60}`.padStart(2, '0');

  return <>
    <div className="section-heading"><div><span className="eyebrow">EJERCICIO 02 / PREPARACIÓN DE VUELO</span><h2 className="mt-2">Prepara tu próxima misión</h2><p className="text-secondary">Selecciona suministros, administra tus créditos y confirma antes del lanzamiento.</p></div>
      <Button color="primary" onClick={() => operar('/api/mision', 'POST', undefined, true)} disabled={ocupado}>{carga ? 'Iniciar nueva misión' : 'Iniciar misión'}</Button></div>
    {error && <UncontrolledAlert key={error} color="warning" role="alert">{error}</UncontrolledAlert>}
    {carga?.estado === 'expirada' && <Alert color="danger">Sesión cerrada: terminó la ventana de lanzamiento. Inicia una nueva misión.</Alert>}
    {carga?.estado === 'confirmada' && <Alert color="success">¡Equipamiento confirmado! La carga está bloqueada y la nave está lista para despegar.</Alert>}
    <Alert color="info" className="mission-status">
      <div><small>CRÉDITOS DISPONIBLES</small><strong>{creditos(carga?.creditos ?? 500)} <span>Cr</span></strong></div>
      <div><small>COSTO TOTAL DE CARGA</small><Badge color="dark" pill>{creditos(carga?.total ?? 0)} Cr</Badge></div>
      <div><small>VENTANA DE LANZAMIENTO</small><strong className={activa && restante <= 30 ? 'text-danger' : ''}>{carga?.estado === 'confirmada' ? 'Confirmada' : activa ? `${minutos}:${segundos}` : 'Sin misión activa'}</strong></div>
    </Alert>
    <div className="operation-status" role="status" aria-live="polite">{ocupado ? 'Calculando peso…' : activa ? 'Misión activa · Reservas sincronizadas con la base' : 'Centro de control listo'}</div>
    <Row className="g-4"><Col xl="8"><div className="d-flex justify-content-between align-items-center mb-3"><h3>Catálogo de la base</h3><span className="text-secondary small">{inventario.length} suministros</span></div>
      <Row className="g-3">{inventario.map((equipo) => <Col md="4" xs="12" key={equipo.id}><Card className="supply-card mb-3 h-100"><CardBody className="d-flex flex-column p-3">
        <div className="supply-symbol" aria-hidden="true">{({ 'Soporte Vital': 'O₂', Alimentación: '◈', Salud: '+', Energía: 'ϟ', Ingeniería: '⚙', Exploración: '◎' })[equipo.categoria]}</div>
        <small className="category">{equipo.categoria}</small><h4>{equipo.nombre}</h4>
        <div className="d-flex justify-content-between align-items-center mt-auto mb-3"><Badge color="success">{equipo.precio} Cr</Badge><span className="stock">{equipo.stock} en base</span></div>
        <Button color={equipo.stock === 0 ? 'secondary' : 'primary'} outline={equipo.stock > 0} disabled={!activa || ocupado || equipo.stock === 0} onClick={() => operar('/api/carga/agregar', 'POST', { equipoId: equipo.id, cantidad: 1 })}>{equipo.stock === 0 ? 'Agotado en Base' : 'Añadir a la Nave'}</Button>
      </CardBody></Card></Col>)}</Row>
    </Col><Col xl="4"><Card className="cargo-panel"><CardBody className="p-4"><span className="eyebrow">MANIFIESTO DE VIAJE</span><h3 className="mt-2">Tu bodega de carga</h3><p className="text-secondary small">Presupuesto inicial: 500 Cr</p>
      {!carga?.itemsCargados.length ? <div className="empty-state"><div className="mb-2 fs-2" aria-hidden="true">▤</div>Tu bodega está vacía.<br/><small>Agrega suministros desde el catálogo.</small></div> : <ListGroup flush>{carga.itemsCargados.map((item) => {
        const equipo = inventario.find((e) => e.id === item.id);
        return <ListGroupItem key={item.id} className="px-0 py-3"><h4>{equipo?.nombre ?? `Equipo ${item.id}`}</h4><p className="small text-secondary">{creditos((equipo?.precio ?? 0) * item.cantidad)} Cr · {item.cantidad} unidad(es)</p>
          <div className="d-flex flex-wrap justify-content-between gap-2"><ButtonGroup size="sm"><Button outline color="secondary" aria-label={`Disminuir ${equipo?.nombre}`} disabled={!activa || ocupado || item.cantidad <= 1} onClick={() => operar(`/api/carga/actualizar-unidades/${item.id}`, 'PUT', { cantidad: item.cantidad - 1 })}>−</Button><span className="quantity" aria-label="Cantidad">{item.cantidad}</span><Button outline color="secondary" aria-label={`Aumentar ${equipo?.nombre}`} disabled={!activa || ocupado} onClick={() => operar(`/api/carga/actualizar-unidades/${item.id}`, 'PUT', { cantidad: item.cantidad + 1 })}>+</Button></ButtonGroup>
          <Button color="danger" outline size="sm" disabled={!activa || ocupado} onClick={() => operar(`/api/carga/eliminar/${item.id}`, 'DELETE')}>Desembarcar</Button></div>
        </ListGroupItem>;
      })}</ListGroup>}
      <div className="cargo-total"><span>Total de carga</span><strong>{creditos(carga?.total ?? 0)} Cr</strong></div>
      <Button color="primary" className="w-100" disabled={!activa || ocupado || !carga?.itemsCargados.length} onClick={() => operar('/api/carga/confirmar', 'POST')}>Confirmar equipamiento</Button>
      <p className="small text-secondary mt-3 mb-0">Puedes modificar tus reservas hasta confirmar. Al terminar el tiempo, la base recupera las unidades.</p>
    </CardBody></Card></Col></Row>
  </>;
}

function App() {
  const [panel, setPanel] = useState('logistica');
  return <><header className="topbar"><Container className="d-flex justify-content-between align-items-center gap-3"><a className="brand" href="./"><span className="brand-mark" aria-hidden="true">A</span><span>Astro<span className="brand-light">Logistics</span><small>CENTRO DE OPERACIONES</small></span></a><span className="system-label"><span/> Sistemas en línea</span></Container></header>
    <Container className="py-4 py-md-5"><div className="d-flex justify-content-between align-items-end mb-4 flex-wrap gap-3"><div><span className="eyebrow">CONTROL DE MISIÓN / ÓRBITA TERRESTRE</span><h1 className="mt-2">Todo listo para explorar.</h1></div><nav className="panel-tabs" aria-label="Ejercicios"><button className={panel === 'logistica' ? 'active' : ''} onClick={() => setPanel('logistica')} aria-pressed={panel === 'logistica'}>Suministros</button><button className={panel === 'reactor' ? 'active' : ''} onClick={() => setPanel('reactor')} aria-pressed={panel === 'reactor'}>Reactor</button></nav></div>
      <section hidden={panel !== 'logistica'} aria-label="Logística de misión"><Logistica/></section><section hidden={panel !== 'reactor'} aria-label="Control del reactor"><Reactor/></section>
      <footer>ASTROLOGISTICS LTD. <span>Programación Web · Evaluación II · 2026</span></footer>
    </Container></>;
}

createRoot(document.getElementById('root')).render(<App/>);
