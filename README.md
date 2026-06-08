# AI Smart Attendance System

A complete face recognition attendance project built with React, Express, and MySQL.

## Features

- React scanner page with real-time webcam face recognition.
- React admin panel for students, face images, and attendance records.
- MySQL database with migration files.
- `.env` based database and server configuration.
- Existing `labeled_images/<StudentID_Name>/` folders are seeded into MySQL when the API starts.
- New admin-uploaded images are stored in `uploads/students`.

## Requirements

- Node.js 20 or newer.
- MySQL Server running locally or remotely.

## Setup

Install packages:

```bash
npm install
```

Edit `.env` if your MySQL username, password, host, or database name is different:

```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=face_attendance
```

Create the database tables:

```bash
npm run migrate
```

Run the full project in development:

```bash
npm run dev
```

Open:

- React app: `http://localhost:5173`
- Admin panel: `http://localhost:5173/admin`
- Backend API: `http://localhost:3000/api/health`

## Production Run

Build the React app:

```bash
npm run build
```

Start the Express server:

```bash
npm start
```

Open:

- `http://localhost:3000`
- `http://localhost:3000/admin`

## Migrations

Migration files live in `migrations/`:

```text
migrations/
|-- 001_create_students.sql
`-- 002_create_attendance.sql
```

Run pending migrations with:

```bash
npm run migrate
```

## Project Structure

```text
face-recognition-attendance/
|-- src/                    # React frontend
|   |-- components/
|   |-- api.js
|   |-- App.jsx
|   |-- main.jsx
|   `-- styles.css
|-- server/                 # Express backend and MySQL connection
|   |-- config.js
|   |-- db.js
|   |-- index.js
|   `-- migrate.js
|-- migrations/             # MySQL schema migrations
|-- labeled_images/         # Existing seed face images
|-- uploads/students/       # New admin-uploaded face images
|-- .env
|-- .env.example
|-- index.html
|-- package.json
`-- vite.config.js
```

## Notes

The face recognition library and AI models are loaded from public CDNs in the browser, so the scanner needs internet access when those assets are not cached.
