// Arina Monitor - Client-side JavaScript

// Modal functions
function openModal(monitor = null) {
  const modal = document.getElementById('monitorModal');
  const modalContent = document.getElementById('modalContent');
  const modalTitle = document.getElementById('modalTitle');
  const form = document.getElementById('monitorForm');

  form.reset();

  if (monitor) {
    modalTitle.textContent = 'Edit Monitor';
    document.getElementById('monitorId').value = monitor.id;
    document.getElementById('monitorName').value = monitor.name;
    document.querySelector(`input[name="type"][value="${monitor.type}"]`).checked = true;
    document.getElementById('targetUrl').value = monitor.target_url || '';
    document.getElementById('secretToken').value = monitor.secret_token || '';
    document.getElementById('intervalSeconds').value = monitor.interval_seconds;
    document.getElementById('isActive').checked = monitor.is_active == 1;
    document.getElementById('notifyTelegram').checked = monitor.notify_telegram == 1;
    document.getElementById('notifyPwa').checked = monitor.notify_pwa == 1;
  } else {
    modalTitle.textContent = 'Add Monitor';
    document.getElementById('monitorId').value = '';
  }

  toggleTypeFields();

  modal.classList.remove('hidden');
  setTimeout(() => {
    modalContent.classList.remove('scale-95', 'opacity-0');
    modalContent.classList.add('scale-100', 'opacity-100');
  }, 10);
}

function closeModal() {
  const modal = document.getElementById('monitorModal');
  const modalContent = document.getElementById('modalContent');

  modalContent.classList.remove('scale-100', 'opacity-100');
  modalContent.classList.add('scale-95', 'opacity-0');

  setTimeout(() => {
    modal.classList.add('hidden');
  }, 300);
}

function toggleTypeFields() {
  const type = document.querySelector('input[name="type"]:checked').value;
  const pingFields = document.getElementById('pingFields');
  const apiFields = document.getElementById('apiFields');

  if (type === 'ping') {
    pingFields.classList.remove('hidden');
    apiFields.classList.add('hidden');
  } else {
    pingFields.classList.add('hidden');
    apiFields.classList.remove('hidden');
  }
}

// Edit monitor
async function editMonitor(id) {
  try {
    const response = await fetch(`/api/monitors/${id}`);
    const result = await response.json();

    if (result.success) {
      openModal(result.data);
    } else {
      showNotification('Failed to load monitor', 'error');
    }
  } catch (error) {
    console.error('Edit error:', error);
    showNotification('Failed to load monitor', 'error');
  }
}

// Toggle monitor active/inactive
async function toggleMonitor(id) {
  const toggleWrapper = document.getElementById(`toggle-wrapper-${id}`);
  const toggleInput = document.getElementById(`toggle-${id}`);
  const card = document.getElementById(`monitor-card-${id}`);

  // Add loading state
  if (toggleWrapper) toggleWrapper.classList.add('loading');

  try {
    const response = await fetch(`/api/monitors/${id}/toggle`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' }
    });

    const result = await response.json();

    if (result.success) {
      const monitor = result.data;
      const isActive = monitor.is_active == 1;

      // Update toggle label
      const label = toggleWrapper?.querySelector('.toggle-label');
      if (label) label.textContent = isActive ? 'ON' : 'OFF';

      // Update card paused state
      if (card) {
        if (isActive) {
          card.classList.remove('monitor-card-paused');
        } else {
          card.classList.add('monitor-card-paused');
        }
      }

      // Update status badge
      const badge = document.getElementById(`status-badge-${id}`);
      if (badge) {
        const statusText = isActive ? monitor.status : 'Paused';
        const dot = badge.querySelector('span');

        // Reset badge classes
        badge.className = 'status-badge inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium';
        if (dot) dot.className = 'w-1.5 h-1.5 rounded-full';

        if (!isActive) {
          badge.classList.add('bg-gray-100', 'text-gray-500', 'border', 'border-gray-200');
          if (dot) dot.classList.add('bg-gray-400');
        } else if (monitor.status === 'Online') {
          badge.classList.add('bg-emerald-50', 'text-emerald-700', 'border', 'border-emerald-200');
          if (dot) dot.classList.add('bg-emerald-500', 'animate-pulse');
        } else if (monitor.status === 'Offline') {
          badge.classList.add('bg-rose-50', 'text-rose-700', 'border', 'border-rose-200');
          if (dot) dot.classList.add('bg-rose-500');
        } else {
          badge.classList.add('bg-amber-50', 'text-amber-700', 'border', 'border-amber-200');
          if (dot) dot.classList.add('bg-amber-500');
        }

        // Update text (the text node after the dot span)
        const textNodes = Array.from(badge.childNodes).filter(n => n.nodeType === 3);
        if (textNodes.length > 0) {
          textNodes[textNodes.length - 1].textContent = '\n                ' + statusText + '\n              ';
        }
      }

      // Update title
      if (toggleWrapper) {
        toggleWrapper.title = isActive ? 'Stop monitoring' : 'Start monitoring';
      }

      showNotification(isActive ? 'Monitor started' : 'Monitor stopped', 'success');
      refreshStats();
    } else {
      showNotification('Failed to toggle monitor', 'error');
      // Revert toggle
      if (toggleInput) toggleInput.checked = !toggleInput.checked;
    }
  } catch (error) {
    console.error('Toggle error:', error);
    showNotification('Failed to toggle monitor', 'error');
    // Revert toggle
    if (toggleInput) toggleInput.checked = !toggleInput.checked;
  } finally {
    if (toggleWrapper) toggleWrapper.classList.remove('loading');
  }
}

// Delete monitor
async function deleteMonitor(id) {
  if (!confirm('Are you sure you want to delete this monitor?')) {
    return;
  }

  try {
    const response = await fetch(`/api/monitors/${id}`, {
      method: 'DELETE'
    });
    const result = await response.json();

    if (result.success) {
      const row = document.getElementById(`monitor-row-${id}`);
      if (row) {
        row.remove();
      }
      showNotification('Monitor deleted', 'success');
      refreshStats();
    } else {
      showNotification('Failed to delete monitor', 'error');
    }
  } catch (error) {
    console.error('Delete error:', error);
    showNotification('Failed to delete monitor', 'error');
  }
}

// Form submission
document.getElementById('monitorForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();

  const form = e.target;
  const id = document.getElementById('monitorId').value;
  const isEdit = !!id;

  const formData = {
    name: document.getElementById('monitorName').value,
    type: document.querySelector('input[name="type"]:checked').value,
    target_url: document.getElementById('targetUrl').value,
    interval_seconds: parseInt(document.getElementById('intervalSeconds').value),
    is_active: document.getElementById('isActive').checked,
    notify_telegram: document.getElementById('notifyTelegram').checked,
    notify_pwa: document.getElementById('notifyPwa').checked
  };

  try {
    const url = isEdit ? `/api/monitors/${id}` : '/api/monitors';
    const method = isEdit ? 'PUT' : 'POST';

    const response = await fetch(url, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData)
    });

    const result = await response.json();

    if (result.success) {
      closeModal();
      showNotification(isEdit ? 'Monitor updated' : 'Monitor created', 'success');
      setTimeout(() => window.location.reload(), 500);
    } else {
      showNotification(result.error || 'Failed to save monitor', 'error');
    }
  } catch (error) {
    console.error('Save error:', error);
    showNotification('Failed to save monitor', 'error');
  }
});

// Settings form
document.getElementById('settingsForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();

  const formData = {
    telegram_bot_token: document.getElementById('telegramBotToken').value,
    telegram_chat_id: document.getElementById('telegramChatId').value
  };

  try {
    const response = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData)
    });

    const result = await response.json();

    if (result.success) {
      showNotification('Settings saved successfully', 'success');
    } else {
      showNotification('Failed to save settings', 'error');
    }
  } catch (error) {
    console.error('Settings error:', error);
    showNotification('Failed to save settings', 'error');
  }
});

// Refresh stats
async function refreshStats() {
  try {
    const response = await fetch('/api/stats');
    const result = await response.json();

    if (result.success) {
      // Update stats display if on dashboard
      const totalEl = document.querySelector('.text-3xl.font-bold.text-gray-900');
      const onlineEl = document.querySelector('.text-3xl.font-bold.text-emerald-600');
      const offlineEl = document.querySelector('.text-3xl.font-bold.text-rose-600');

      if (totalEl) totalEl.textContent = result.data.total;
      if (onlineEl) onlineEl.textContent = result.data.online;
      if (offlineEl) offlineEl.textContent = result.data.offline;
    }
  } catch (error) {
    console.error('Stats refresh error:', error);
  }
}

// Notification helper
function showNotification(message, type = 'info') {
  const colors = {
    success: 'bg-emerald-500',
    error: 'bg-rose-500',
    info: 'bg-blue-500'
  };

  const notification = document.createElement('div');
  notification.className = `fixed bottom-4 right-4 ${colors[type]} text-white px-4 py-2.5 rounded-xl shadow-lg font-medium text-sm z-50 fade-in`;
  notification.textContent = message;
  document.body.appendChild(notification);

  setTimeout(() => {
    notification.remove();
  }, 3000);
}

// SSE for real-time updates
let eventSource;

function connectSSE() {
  eventSource = new EventSource('/api/events');

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);

      if (data.type === 'connected') {
        console.log('SSE connected');
      } else if (data.type === 'monitor_updated' || data.type === 'heartbeat' || data.type === 'monitor_toggled') {
        refreshStats();
      }
    } catch (e) {
      console.error('SSE parse error:', e);
    }
  };

  eventSource.onerror = () => {
    console.log('SSE disconnected, reconnecting...');
    setTimeout(connectSSE, 5000);
  };
}

// PWA Install
let deferredPrompt;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;

  const installBtn = document.getElementById('installPwaBtn');
  if (installBtn) {
    installBtn.classList.remove('hidden');
    installBtn.addEventListener('click', () => {
      installPWA();
    });
  }
});

async function installPWA() {
  if (!deferredPrompt) return;

  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;

  if (outcome === 'accepted') {
    document.getElementById('installPwaBtn').classList.add('hidden');
  }
  deferredPrompt = null;
}

// Request notification permission
async function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      console.log('Notification permission granted');
    }
  }
}

// Show push notification
function showPushNotification(title, body, icon) {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, { body, icon });
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  connectSSE();
  requestNotificationPermission();
});

// Service Worker registration
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js')
      .then(registration => {
        console.log('ServiceWorker registered:', registration.scope);
      })
      .catch(error => {
        console.log('ServiceWorker registration failed:', error);
      });
  });
}
