const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Conexión a PostgreSQL (Render te da DATABASE_URL)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

const JWT_SECRET = process.env.JWT_SECRET || 'cambia-esto-en-produccion';

// ==================== AUTENTICACIÓN ====================

// LOGIN
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const result = await pool.query(
      'SELECT * FROM usuarios WHERE username = $1',
      [username]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    const token = jwt.sign(
      { id: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: '8h' }
    );
    res.json({ token, username: user.username });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Middleware de autenticación
function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'Token requerido' });
  try {
    req.user = jwt.verify(header.replace('Bearer ', ''), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

// ==================== API DE VUELOS ====================

// Obtener vuelos de una puerta (público, lo usan pantallas y admin)
app.get('/api/puertas/:puertaId/vuelos', async (req, res) => {
  try {
    const { puertaId } = req.params;
    const result = await pool.query(
      `SELECT * FROM vuelos 
       WHERE puerta_id = $1 AND fecha = CURRENT_DATE 
       ORDER BY hora_programada ASC`,
      [puertaId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al consultar vuelos' });
  }
});

// Crear vuelo (protegido)
app.post('/api/vuelos', auth, async (req, res) => {
  try {
    const {
      numero_vuelo, aerolinea_nombre, aerolinea_logo_url,
      origen, destino, fecha, hora_programada, hora_estimada,
      estado, puerta_id
    } = req.body;

    const result = await pool.query(
      `INSERT INTO vuelos 
        (numero_vuelo, aerolinea_nombre, aerolinea_logo_url, origen, destino,
         fecha, hora_programada, hora_estimada, estado, puerta_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [numero_vuelo, aerolinea_nombre, aerolinea_logo_url, origen, destino,
       fecha, hora_programada, hora_estimada, estado, puerta_id]
    );

    const vuelo = result.rows[0];
    io.emit(`puerta-${vuelo.puerta_id}`, { tipo: 'nuevo', vuelo });
    res.status(201).json(vuelo);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear vuelo' });
  }
});

// Actualizar vuelo (protegido)
app.put('/api/vuelos/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      estado, hora_estimada, destino, numero_vuelo,
      aerolinea_nombre, aerolinea_logo_url, hora_programada
    } = req.body;

    const result = await pool.query(
      `UPDATE vuelos SET
        estado = COALESCE($1, estado),
        hora_estimada = COALESCE($2, hora_estimada),
        destino = COALESCE($3, destino),
        numero_vuelo = COALESCE($4, numero_vuelo),
        aerolinea_nombre = COALESCE($5, aerolinea_nombre),
        aerolinea_logo_url = COALESCE($6, aerolinea_logo_url),
        hora_programada = COALESCE($7, hora_programada),
        updated_at = NOW()
       WHERE id = $8 RETURNING *`,
      [estado, hora_estimada, destino, numero_vuelo,
       aerolinea_nombre, aerolinea_logo_url, hora_programada, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Vuelo no encontrado' });
    }

    const vuelo = result.rows[0];
    // 🔥 Notificar a todas las pantallas de esa puerta en tiempo real
    io.emit(`puerta-${vuelo.puerta_id}`, { tipo: 'actualizacion', vuelo });
    res.json(vuelo);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar vuelo' });
  }
});

// Eliminar vuelo (protegido)
app.delete('/api/vuelos/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'DELETE FROM vuelos WHERE id = $1 RETURNING *',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Vuelo no encontrado' });
    }
    const vuelo = result.rows[0];
    io.emit(`puerta-${vuelo.puerta_id}`, { tipo: 'eliminado', vuelo });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar vuelo' });
  }
});

// ==================== WEBSOCKETS ====================
io.on('connection', (socket) => {
  console.log('Cliente conectado:', socket.id);

  socket.on('suscribir-puerta', (puertaId) => {
    socket.join(`puerta-${puertaId}`);
    console.log(`Socket ${socket.id} suscrito a puerta ${puertaId}`);
  });

  socket.on('disconnect', () => {
    console.log('Cliente desconectado:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor en puerto ${PORT}`));
