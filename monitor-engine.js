const axios = require('axios');
const { monitorQueries, logQueries, settingsQueries } = require('./db');

const PING_TIMEOUT = 5000; // 5 seconds
const monitorJobs = new Map();
const consecutiveFailures = new Map(); // Track consecutive failures per monitor

// Check a ping monitor
async function checkPingMonitor(monitor) {
  const startTime = Date.now();
  try {
    const response = await axios.get(monitor.target_url, {
      timeout: PING_TIMEOUT,
      validateStatus: (status) => status >= 200 && status < 400,
      maxRedirects: 5
    });

    const responseTime = Date.now() - startTime;
    const isOnline = response.status >= 200 && response.status < 400;

    // Reset failure count on success
    consecutiveFailures.set(monitor.id, 0);

    updateMonitorStatus(monitor, isOnline ? 'Online' : 'Offline',
      `HTTP ${response.status} - ${responseTime}ms`
    );

    return { success: true, status: 'Online', responseTime };
  } catch (error) {
    const errorMessage = error.code === 'ECONNABORTED' ? 'Request timeout'
      : error.code === 'ENOTFOUND' ? 'Host not found'
      : error.code === 'ECONNREFUSED' ? 'Connection refused'
      : error.message;

    // Increment failure count
    const failures = (consecutiveFailures.get(monitor.id) || 0) + 1;
    consecutiveFailures.set(monitor.id, failures);

    // Only notify after 2 consecutive failures
    if (failures >= 2) {
      updateMonitorStatus(monitor, 'Offline', errorMessage);
    }

    return { success: false, status: 'Offline', error: errorMessage };
  }
}

// Update monitor status and log
function updateMonitorStatus(monitor, newStatus, message) {
  const previousStatus = monitor.status;

  // Update monitor status
  monitorQueries.updateStatus({
    id: monitor.id,
    status: newStatus,
    last_seen: new Date().toISOString()
  });

  // Create log entry if status changed
  if (previousStatus !== newStatus) {
    logQueries.create({
      monitor_id: monitor.id,
      status: newStatus,
      message: message || `Status changed to ${newStatus}`
    });

    // Send notifications if enabled
    if (newStatus === 'Offline' && monitor.notify_telegram) {
      sendTelegramNotification(monitor, 'Offline', message);
    }

    // Broadcast PWA notification
    if (newStatus === 'Offline' && monitor.notify_pwa) {
      broadcastPushNotification(monitor, 'Offline', message);
    }
  }
}

// Send Telegram notification
async function sendTelegramNotification(monitor, status, message) {
  try {
    const botTokenSetting = settingsQueries.get('telegram_bot_token');
    const chatIdSetting = settingsQueries.get('telegram_chat_id');
    const botToken = botTokenSetting?.value;
    const chatId = chatIdSetting?.value;

    if (!botToken || !chatId) return;

    const text = `🔴 *Arina Monitor Alert*\n\n*Monitor:* ${monitor.name}\n*Status:* ${status}\n*Message:* ${message}\n*Time:* ${new Date().toLocaleString()}`;

    await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      chat_id: chatId,
      text: text,
      parse_mode: 'Markdown'
    });
  } catch (error) {
    console.error(`Telegram notification failed for monitor ${monitor.id}:`, error.message);
  }
}

// Broadcast push notification to PWA clients
const pushSubscribers = new Set();

function broadcastPushNotification(monitor, status, message) {
  const notification = {
    type: 'status_change',
    monitorId: monitor.id,
    monitorName: monitor.name,
    status: status,
    message: message,
    timestamp: new Date().toISOString()
  };

  pushSubscribers.forEach(callback => {
    try {
      callback(notification);
    } catch (e) {
      pushSubscribers.delete(callback);
    }
  });
}

function subscribeToPushNotifications(callback) {
  pushSubscribers.add(callback);
  return () => pushSubscribers.delete(callback);
}

// Start monitoring a single ping monitor
function startPingMonitor(monitor) {
  if (monitorJobs.has(monitor.id)) {
    stopMonitor(monitor.id);
  }

  const intervalMs = (monitor.interval_seconds || 60) * 1000;

  // Run immediately
  checkPingMonitor(monitor);

  // Schedule recurring checks
  const job = setInterval(() => {
    const currentMonitor = monitorQueries.getById(monitor.id);
    if (currentMonitor && currentMonitor.is_active) {
      checkPingMonitor(currentMonitor);
    } else {
      stopMonitor(monitor.id);
    }
  }, intervalMs);

  monitorJobs.set(monitor.id, job);
  console.log(`Started ping monitor: ${monitor.name} (${monitor.target_url}) every ${monitor.interval_seconds}s`);
}

// Stop monitoring a single monitor
function stopMonitor(monitorId) {
  if (monitorJobs.has(monitorId)) {
    clearInterval(monitorJobs.get(monitorId));
    monitorJobs.delete(monitorId);
    console.log(`Stopped monitor: ${monitorId}`);
  }
}

// Start all active ping monitors
function startAllPingMonitors() {
  const monitors = monitorQueries.getActiveByType('ping');
  monitors.forEach(monitor => {
    startPingMonitor(monitor);
  });
  console.log(`Started ${monitors.length} ping monitors`);
}

// Restart a monitor (used after updates)
function restartMonitor(monitorId) {
  const monitor = monitorQueries.getById(monitorId);
  if (monitor && monitor.is_active && monitor.type === 'ping') {
    startPingMonitor(monitor);
  } else {
    stopMonitor(monitorId);
  }
}

// Process API heartbeat
function processHeartbeat(token) {
  const monitors = monitorQueries.getAll();
  const monitor = monitors.find(m =>
    m.type === 'api' && m.secret_token === token
  );

  if (!monitor) {
    return { success: false, error: 'Invalid token' };
  }

  if (!monitor.is_active) {
    return { success: false, error: 'Monitor is inactive' };
  }

  const previousStatus = monitor.status;
  const now = new Date().toISOString();

  // Update status to Online
  monitorQueries.updateStatus({
    id: monitor.id,
    status: 'Online',
    last_seen: now
  });

  // Log if status changed
  if (previousStatus !== 'Online') {
    logQueries.create({
      monitor_id: monitor.id,
      status: 'Online',
      message: 'Heartbeat received'
    });

    if (monitor.notify_telegram) {
      sendTelegramNotification(monitor, 'Online', 'Heartbeat received');
    }
  }

  return { success: true, monitor: { id: monitor.id, name: monitor.name } };
}

// Get pending API monitors (have not sent heartbeat within expected interval)
function checkPendingApiMonitors() {
  const apiMonitors = monitorQueries.getActiveByType('api');
  const now = Date.now();

  apiMonitors.forEach(monitor => {
    if (monitor.last_seen) {
      const lastSeen = new Date(monitor.last_seen).getTime();
      const intervalMs = (monitor.interval_seconds || 60) * 1000 * 2; // 2x interval for pending

      if (now - lastSeen > intervalMs && monitor.status !== 'Offline') {
        monitorQueries.updateStatus({
          id: monitor.id,
          status: 'Offline',
          last_seen: monitor.last_seen
        });

        logQueries.create({
          monitor_id: monitor.id,
          status: 'Offline',
          message: 'No heartbeat received within expected interval'
        });

        if (monitor.notify_telegram) {
          sendTelegramNotification(monitor, 'Offline', 'No heartbeat received');
        }
      }
    }
  });
}

// Initialize the monitor engine
function initialize() {
  startAllPingMonitors();

  // Check pending API monitors every minute
  setInterval(checkPendingApiMonitors, 60000);

  console.log('Monitor engine initialized');
}

module.exports = {
  initialize,
  startPingMonitor,
  stopMonitor,
  restartMonitor,
  checkPingMonitor,
  processHeartbeat,
  subscribeToPushNotifications
};
