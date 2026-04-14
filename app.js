const express = require('express');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Prevent silent exits
process.on('uncaughtException', (err) => {
  console.error('CRITICAL: Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('CRITICAL: Unhandled Rejection at:', promise, 'reason:', reason);
});

const { initializeDatabase, monitorQueries, logQueries, settingsQueries } = require('./db');
const monitorEngine = require('./monitor-engine');

const app = express();
const PORT = process.env.PORT || 100;

// Catch express async errors
app.on('error', (err) => {
  console.error('Express server error:', err);
});
// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// SSE clients for real-time updates
const sseClients = new Set();

// Helper: Format relative time
function formatRelativeTime(timestamp) {
  if (!timestamp) return 'Never';
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diff = now - then;

  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

// Broadcast to all SSE clients
function broadcastUpdate(data) {
  const message = `data: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(client => {
    try {
      client.write(message);
    } catch (e) {
      sseClients.delete(client);
    }
  });
}

// ==================== ROUTES ====================

// Dashboard
app.get('/', (req, res) => {
  try {
    const monitors = monitorQueries.getAll();
    const stats = monitorQueries.getStats();

    res.render('dashboard', {
      monitors,
      stats: {
        total: stats.total || 0,
        online: stats.online || 0,
        offline: stats.offline || 0,
        pending: stats.pending || 0
      },
      formatRelativeTime
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).render('error', { message: 'Failed to load dashboard' });
  }
});

// History page
app.get('/history', (req, res) => {
  try {
    const logs = logQueries.getRecent();
    res.render('history', { logs, formatRelativeTime });
  } catch (error) {
    console.error('History error:', error);
    res.status(500).render('error', { message: 'Failed to load history' });
  }
});

// Settings page
app.get('/settings', (req, res) => {
  try {
    const settings = {};
    settingsQueries.getAll().forEach(row => {
      settings[row.key] = row.value;
    });
    res.render('settings', { settings });
  } catch (error) {
    console.error('Settings error:', error);
    res.status(500).render('error', { message: 'Failed to load settings' });
  }
});

// API: Get all monitors
app.get('/api/monitors', (req, res) => {
  try {
    const monitors = monitorQueries.getAll();
    res.json({ success: true, data: monitors });
  } catch (error) {
    console.error('API error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch monitors' });
  }
});

// API: Get single monitor
app.get('/api/monitors/:id', (req, res) => {
  try {
    const monitor = monitorQueries.getById(req.params.id);
    if (!monitor) {
      return res.status(404).json({ success: false, error: 'Monitor not found' });
    }
    res.json({ success: true, data: monitor });
  } catch (error) {
    console.error('API error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch monitor' });
  }
});

// API: Create monitor
app.post('/api/monitors', (req, res) => {
  try {
    const { name, type, target_url, interval_seconds, notify_telegram, notify_pwa } = req.body;

    if (!name || !type) {
      return res.status(400).json({ success: false, error: 'Name and type are required' });
    }

    const secret_token = uuidv4();

    const monitor = monitorQueries.create({
      name,
      type,
      target_url: type === 'ping' ? target_url : null,
      secret_token,
      interval_seconds: parseInt(interval_seconds) || 60,
      is_active: 1,
      notify_telegram: notify_telegram ? 1 : 0,
      notify_pwa: notify_pwa ? 1 : 0,
      status: 'Pending'
    });

    // Start the monitor if it's a ping type
    if (type === 'ping') {
      monitorEngine.startPingMonitor(monitor);
    }

    broadcastUpdate({ type: 'monitor_created', monitor });
    res.json({ success: true, data: monitor });
  } catch (error) {
    console.error('Create monitor error:', error);
    res.status(500).json({ success: false, error: 'Failed to create monitor' });
  }
});

// API: Update monitor
app.put('/api/monitors/:id', (req, res) => {
  try {
    const { name, type, target_url, interval_seconds, is_active, notify_telegram, notify_pwa } = req.body;
    const id = req.params.id;

    const existing = monitorQueries.getById(id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Monitor not found' });
    }

    const monitor = monitorQueries.update({
      id,
      name,
      type,
      target_url: type === 'ping' ? target_url : null,
      secret_token: existing.secret_token,
      interval_seconds: parseInt(interval_seconds) || 60,
      is_active: is_active ? 1 : 0,
      notify_telegram: notify_telegram ? 1 : 0,
      notify_pwa: notify_pwa ? 1 : 0
    });

    // Restart the monitor to apply new settings
    monitorEngine.restartMonitor(id);

    broadcastUpdate({ type: 'monitor_updated', monitor });
    res.json({ success: true, data: monitor });
  } catch (error) {
    console.error('Update monitor error:', error);
    res.status(500).json({ success: false, error: 'Failed to update monitor' });
  }
});

// API: Delete monitor
app.delete('/api/monitors/:id', (req, res) => {
  try {
    const id = req.params.id;

    const existing = monitorQueries.getById(id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Monitor not found' });
    }

    monitorEngine.stopMonitor(id);
    monitorQueries.delete(id);

    broadcastUpdate({ type: 'monitor_deleted', monitorId: id });
    res.json({ success: true });
  } catch (error) {
    console.error('Delete monitor error:', error);
    res.status(500).json({ success: false, error: 'Failed to delete monitor' });
  }
});

// API: Toggle monitor active state
app.patch('/api/monitors/:id/toggle', (req, res) => {
  try {
    const id = req.params.id;
    const existing = monitorQueries.getById(id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Monitor not found' });
    }

    const newActive = existing.is_active ? 0 : 1;

    monitorQueries.update({
      id,
      name: existing.name,
      type: existing.type,
      target_url: existing.target_url,
      secret_token: existing.secret_token,
      interval_seconds: existing.interval_seconds,
      is_active: newActive,
      notify_telegram: existing.notify_telegram,
      notify_pwa: existing.notify_pwa
    });

    // Start or stop the monitor engine accordingly
    if (newActive && existing.type === 'ping') {
      const updatedMonitor = monitorQueries.getById(id);
      monitorEngine.startPingMonitor(updatedMonitor);
    } else {
      monitorEngine.stopMonitor(id);
    }

    const monitor = monitorQueries.getById(id);
    broadcastUpdate({ type: 'monitor_toggled', monitor });
    res.json({ success: true, data: monitor });
  } catch (error) {
    console.error('Toggle monitor error:', error);
    res.status(500).json({ success: false, error: 'Failed to toggle monitor' });
  }
});

// API: Heartbeat endpoint
app.post('/api/heartbeat', (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ success: false, error: 'Token is required' });
    }

    const result = monitorEngine.processHeartbeat(token);

    if (!result.success) {
      return res.status(401).json(result);
    }

    broadcastUpdate({
      type: 'heartbeat',
      monitorId: result.monitor.id,
      monitorName: result.monitor.name
    });

    res.json({ success: true, monitor: result.monitor });
  } catch (error) {
    console.error('Heartbeat error:', error);
    res.status(500).json({ success: false, error: 'Heartbeat processing failed' });
  }
});

// API: Get stats
app.get('/api/stats', (req, res) => {
  try {
    const stats = monitorQueries.getStats();
    res.json({ success: true, data: stats });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch stats' });
  }
});

// API: Get logs
app.get('/api/logs', (req, res) => {
  try {
    const { monitor_id, limit } = req.query;
    let logs;

    if (monitor_id) {
      logs = logQueries.getByMonitorId(monitor_id);
    } else {
      logs = logQueries.getRecent();
    }

    if (limit) {
      logs = logs.slice(0, parseInt(limit));
    }

    res.json({ success: true, data: logs });
  } catch (error) {
    console.error('Logs error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch logs' });
  }
});

// API: Update settings
app.post('/api/settings', (req, res) => {
  try {
    const { telegram_bot_token, telegram_chat_id } = req.body;

    if (telegram_bot_token !== undefined) {
      settingsQueries.set('telegram_bot_token', telegram_bot_token);
    }
    if (telegram_chat_id !== undefined) {
      settingsQueries.set('telegram_chat_id', telegram_chat_id);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Settings error:', error);
    res.status(500).json({ success: false, error: 'Failed to update settings' });
  }
});

// SSE endpoint for real-time updates
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Send initial connection message
  res.write('data: {"type":"connected"}\n\n');

  sseClients.add(res);

  req.on('close', () => {
    sseClients.delete(res);
  });
});

// Serve manifest.json
app.get('/manifest.json', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'manifest.json'));
});

// Serve service worker
app.get('/service-worker.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'service-worker.js'));
});

// ==================== START SERVER ====================

async function startServer() {
  try {
    // Initialize database
    await initializeDatabase();
    console.log('Database initialized');

    // Subscribe to push notifications
    monitorEngine.subscribeToPushNotifications((notification) => {
      broadcastUpdate({ type: 'notification', ...notification });
    });

    // Initialize monitor engine
    monitorEngine.initialize();

    app.listen(PORT, () => {
      console.log(`
╔═══════════════════════════════════════════════════════╗
║                                                       ║
║   🔔 Arina Monitor - Premium Heartbeat Monitoring     ║
║                                                       ║
║   Server running at: http://localhost:${PORT}             ║
║                                                       ║
╚═══════════════════════════════════════════════════════╝
      `);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
