# Playmist — Official Website

> Built with **Node.js + Express + MySQL + EJS**  
> Domain: [playmist.app](https://playmist.app)

---

## 📁 Project Structure

```
web/
├── config/
│   ├── database.js      # MySQL connection pool
│   └── schema.sql       # Database setup script
├── public/
│   ├── css/
│   │   └── style.css    # Main stylesheet (dark gaming theme)
│   └── js/
│       └── main.js      # Client-side scripts
├── views/
│   └── index.ejs        # Landing page template
├── .env                 # Environment variables (do not commit)
├── .env.example         # Template for env vars
├── package.json
└── server.js            # Express app entry point
```

---

## 🚀 Quick Start

### 1. Install dependencies
```bash
cd web
npm install
```

### 2. Set up environment
```bash
cp .env.example .env
# Edit .env with your MySQL credentials and store links
```

### 3. Set up MySQL database
```bash
mysql -u root -p < config/schema.sql
```

### 4. Run the development server
```bash
npm run dev       # uses nodemon (auto-reload)
# OR
npm start         # production
```

The site will be available at **http://localhost:3000**

---

## ⚙️ Environment Variables

| Variable | Description |
|---|---|
| `PORT` | Server port (default: 3000) |
| `DB_HOST` | MySQL host |
| `DB_PORT` | MySQL port (default: 3306) |
| `DB_USER` | MySQL username |
| `DB_PASSWORD` | MySQL password |
| `DB_NAME` | Database name |
| `ANDROID_STORE_URL` | Google Play Store link |
| `IOS_STORE_URL` | Apple App Store link |

> **Note:** The site works even if MySQL is not configured — fallback default values are used.

---

## 🎮 Features

- **Hero Section** with animated phone mockup and particle background
- **Features Grid** showcasing WebGL instant games and offline premium games
- **Games Showcase** with tabbed view (Instant / Premium)
- **How It Works** 3-step section
- **Download CTA** with Google Play + App Store buttons
- **Responsive** — works on all screen sizes
- **SEO-ready** — proper meta tags, semantic HTML

---

## 🌐 Deploying to playmist.app

1. Set up your server (VPS, Railway, Render, etc.)
2. Point DNS `A` record for `playmist.app` to your server IP
3. Use **nginx** as a reverse proxy to port 3000
4. Use **Let's Encrypt / certbot** for HTTPS
5. Set all production environment variables

Example nginx config:
```nginx
server {
    server_name playmist.app www.playmist.app;
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```
