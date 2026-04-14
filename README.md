# Arina Monitor

Premium Server Heartbeat Monitor - A PWA for monitoring servers and devices via active ping or passive API heartbeats.

## Features

- **Active Ping Monitoring** - HTTP/HTTPS endpoint monitoring at configurable intervals
- **Passive API Heartbeat** - External services send heartbeats to stay online
- **Real-time Dashboard** - Live status updates via Server-Sent Events
- **Telegram Notifications** - Get alerts when services go offline
- **PWA Support** - Install as an app on mobile/desktop
- **Premium UI** - Tailwind CSS with Inter font, responsive design
- **Card-based Grid Layout** - Modern card UI with toggle switches for each monitor
- **Quick Toggle** - Instantly pause/resume monitoring without editing

## Quick Start

```bash
npm install
npm start
```

Open [http://localhost:100](http://localhost:100)

## API Reference

### Send Heartbeat (API Monitor)

```bash
curl -X POST http://localhost:100/api/heartbeat \
  -H "Content-Type: application/json" \
  -d '{"token": "YOUR_SECRET_TOKEN"}'
```

### Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/heartbeat` | External heartbeat |
| `GET` | `/api/monitors` | List all monitors |
| `POST` | `/api/monitors` | Create monitor |
| `PUT` | `/api/monitors/:id` | Update monitor |
| `PATCH` | `/api/monitors/:id/toggle` | Toggle monitor active state |
| `DELETE` | `/api/monitors/:id` | Delete monitor |
| `GET` | `/api/stats` | Get statistics |
| `GET` | `/api/events` | SSE real-time updates |

## Configuration

### Telegram Notifications

1. Create a bot via [@BotFather](https://t.me/BotFather)
2. Get your Chat ID by messaging [@userinfobot](https://t.me/userinfobot)
3. Enter Bot Token and Chat ID in Settings page

### Monitor Types

- **Ping**: System pings the URL every N seconds
- **API**: Your service calls `/api/heartbeat` with token; marked offline if no heartbeat within 2x interval

## Tech Stack

- Node.js + Express
- SQLite (better-sqlite3)
- EJS templating
- Tailwind CSS
- PWA (manifest + service worker)

## Project Structure

```
├── app.js              # Express server & routes
├── db.js               # SQLite database layer
├── monitor-engine.js   # Background ping/heartbeat worker
├── public/
│   ├── js/app.js       # Client-side JavaScript
│   ├── manifest.json   # PWA manifest
│   └── service-worker.js
└── views/              # EJS templates
```

## License

MIT
