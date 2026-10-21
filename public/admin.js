// ==================== ESTADO ====================
let token = localStorage.getItem('token');
let username = localStorage.getItem('username');
let puertaActual = 1;

// ==================== LOGIN ====================
async function login() {
  const user = document.getElementById('username').value.trim();
  const pass = document.getElementById('password').value;
  const errEl = document.getElementById('loginError');
  errEl.textContent = '';

  if (!user || !pass) {
    errEl.textContent = 'Completa usuario y contraseña';
    return;
  }

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user, password: pass })
    });

    const data = await res.json();

    if (!res.ok) {
      errEl.textContent = data.error || 'Error de login';
      return;
    }

    token = data.token;
    username = data.username;
    localStorage.setItem('token', token);
    localStorage.setItem('username', username);
    mostrarPanel();
  } catch (err) {
    errEl.textContent = 'Error de conexión con el servidor';
  }
}

function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('username');
  token = null;
  username = null;
  document.getElementById('panelView').style.display = 'none';
  document.getElementById('loginView').style.display = 'flex';
  document.getElementById('password').value = '';
}

function mostrarPanel() {
  document.getElementById('loginView').style.display = 'none';
  document.getElementById('panelView').style.display = 'block';
  document.getElementById('currentUser').textContent = username;

  // Suscribirse al socket de la puerta actual
  suscribirSocket();
  cargarVuelos();
}

// ==================== WEBSOCKETS ====================
let socket = null;

function suscribirSocket() {
  if (socket) socket.disconnect();
  socket = io();
  socket.on('connect', () => {
    socket.emit('suscribir-puerta', puertaActual);
  });
  socket.on(`puerta-${puertaActual}`, () => {
    // Otro operador cambió algo: refrescamos la vista del admin también
    cargarVuelos();
  });
}

// ==================== CARGAR VUELOS ====================
async function cargarVuelos() {
  puertaActual = parseInt(document.getElementById('filtroPuerta').value);
  if (socket) socket.disconnect(), suscribirSocket();

  const container = document.getElementById('listaVuelos');
  container.innerHTML = '<div class="empty-state"><div class="icon">⏳</div>Cargando vuelos...</div>';

  try {
    const res = await fetch(`/api/puertas/${puertaActual}/vuelos`);
    const vuelos = await res.json();
    renderizarVuelos(vuelos);
  } catch (err) {
    container.innerHTML = '<div class="empty-state"><div class="icon">⚠️</div>Error al cargar</div>';
  }
}

function renderizarVuelos(vuelos) {
  const container = document.getElementById('listaVuelos');

  if (vuelos.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="grid-column: 1/-1;">
        <div class="icon">🛫</div>
        <p>No hay vuelos asignados a esta puerta hoy.</p>
        <button class="btn btn-primary" style="width:auto;margin-top:16px;" onclick="abrirModalNuevo()">
          + Crear primer vuelo
        </button>
      </div>`;
    return;
  }

  container.innerHTML = vuelos.map(v => `
    <div class="vuelo-card">
      <div class="header">
        <span class="num-vuelo">${v.numero_vuelo}</span>
        <span class="badge ${v.estado}">${traducirEstado(v.estado)}</span>
      </div>
      <div class="destino">✈️ ${v.destino}</div>
      <div class="info-row"><b>Aerolínea:</b> ${v.aerolinea_nombre}</div>
      <div class="info-row"><b>Programado:</b> ${v.hora_programada?.slice(0,5)}</div>
      <div class="info-row"><b>Estimado:</b> ${v.hora_estimada?.slice(0,5) || '—'}</div>
      <div class="acciones">
        <button class="btn btn-secondary btn-sm" onclick="cambiarEstado(${v.id}, 'EMBARQUE')">Embarque</button>
        <button class="btn btn-secondary btn-sm" onclick="cambiarEstado(${v.id}, 'RETRASADO')">Retrasar</button>
        <button class="btn btn-secondary btn-sm" onclick="abrirModalEditar(${v.id})">Editar</button>
        <button class="btn btn-danger btn-sm" onclick="eliminarVuelo(${v.id})">Eliminar</button>
      </div>
    </div>
  `).join('');
}

function traducirEstado(estado) {
  const map = {
    PROGRAMADO: 'Programado',
    EMBARQUE: 'Embarque',
    RETRASADO: 'Retrasado',
    CANCELADO: 'Cancelado',
    ULTIMA_LLAMADA: 'Última llamada',
    DESPEGADO: 'Despegado'
  };
  return map[estado] || estado;
}

// ==================== MODAL ====================
function abrirModalNuevo() {
  document.getElementById('modalTitulo').textContent = 'Nuevo vuelo';
  document.getElementById('vueloId').value = '';
  document.getElementById('f_numero').value = '';
  document.getElementById('f_aerolinea').value = '';
  document.getElementById('f_logo').value = '';
  document.getElementById('f_origen').value = '';
  document.getElementById('f_destino').value = '';
  document.getElementById('f_fecha').value = new Date().toISOString().split('T')[0];
  document.getElementById('f_hora_prog').value = '';
  document.getElementById('f_hora_est').value = '';
  document.getElementById('f_estado').value = 'PROGRAMADO';
  document.getElementById('f_puerta').value = puertaActual;
  document.getElementById('modalVuelo').classList.add('active');
}

function abrirModalEditar(id) {
  // Buscar el vuelo en la vista actual
  const card = event.target.closest('.vuelo-card');
  // Alternativa robusta: pedir los datos al backend
  fetch(`/api/puertas/${puertaActual}/vuelos`)
    .then(r => r.json())
    .then(vuelos => {
      const v = vuelos.find(x => x.id === id);
      if (!v) return;

      document.getElementById('modalTitulo').textContent = 'Editar vuelo';
      document.getElementById('vueloId').value = v.id;
      document.getElementById('f_numero').value = v.numero_vuelo;
      document.getElementById('f_aerolinea').value = v.aerolinea_nombre;
      document.getElementById('f_logo').value = v.aerolinea_logo_url || '';
      document.getElementById('f_origen').value = v.origen || '';
      document.getElementById('f_destino').value = v.destino;
      document.getElementById('f_fecha').value = v.fecha?.split('T')[0] || '';
      document.getElementById('f_hora_prog').value = v.hora_programada?.slice(0,5) || '';
      document.getElementById('f_hora_est').value = v.hora_estimada?.slice(0,5) || '';
      document.getElementById('f_estado').value = v.estado;
      document.getElementById('f_puerta').value = v.puerta_id;
      document.getElementById('modalVuelo').classList.add('active');
    });
}

function cerrarModal() {
  document.getElementById('modalVuelo').classList.remove('active');
}

async function guardarVuelo() {
  const id = document.getElementById('vueloId').value;
  const payload = {
    numero_vuelo: document.getElementById('f_numero').value.trim(),
    aerolinea_nombre: document.getElementById('f_aerolinea').value.trim(),
    aerolinea_logo_url: document.getElementById('f_logo').value.trim(),
    origen: document.getElementById('f_origen').value.trim(),
    destino: document.getElementById('f_destino').value.trim(),
    fecha: document.getElementById('f_fecha').value,
    hora_programada: document.getElementById('f_hora_prog').value,
    hora_estimada: document.getElementById('f_hora_est').value || null,
    estado: document.getElementById('f_estado').value,
    puerta_id: parseInt(document.getElementById('f_puerta').value)
  };

  if (!payload.numero_vuelo || !payload.aerolinea_nombre || !payload.destino || !payload.fecha || !payload.hora_programada) {
    toast('Completa todos los campos obligatorios', 'error');
    return;
  }

  const url = id ? `/api/vuelos/${id}` : '/api/vuelos';
  const method = id ? 'PUT' : 'POST';

  try {
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const err = await res.json();
      toast(err.error || 'Error al guardar', 'error');
      return;
    }

    cerrarModal();
    toast(id ? 'Vuelo actualizado ✓' : 'Vuelo creado ✓', 'success');
    cargarVuelos();
  } catch (err) {
    toast('Error de conexión', 'error');
  }
}

// ==================== ACCIONES RÁPIDAS ====================
async function cambiarEstado(id, nuevoEstado) {
  try {
    const res = await fetch(`/api/vuelos/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ estado: nuevoEstado })
    });
    if (!res.ok) { toast('Error al cambiar estado', 'error'); return; }
    toast('Estado actualizado ✓', 'success');
    cargarVuelos();
  } catch {
    toast('Error de conexión', 'error');
  }
}

async function eliminarVuelo(id) {
  if (!confirm('¿Eliminar este vuelo? Esta acción no se puede deshacer.')) return;
  try {
    const res = await fetch(`/api/vuelos/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) { toast('Error al eliminar', 'error'); return; }
    toast('Vuelo eliminado', 'success');
    cargarVuelos();
  } catch {
    toast('Error de conexión', 'error');
  }
}

// ==================== UTILIDADES ====================
let toastTimer = null;
function toast(msg, tipo = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'show ' + tipo;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.className = '', 3000);
}

// ==================== INICIALIZACIÓN ====================
if (token && username) {
  mostrarPanel();
} else {
  document.getElementById('loginView').style.display = 'flex';
}
