import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { execute, pool, query } from './db.js';

const app = express();
const labeledImageDir = path.join(config.rootDir, 'labeled_images');

fs.mkdirSync(config.uploadDir, { recursive: true });
fs.mkdirSync(labeledImageDir, { recursive: true });

app.use(cors({ origin: config.clientOrigin, credentials: true }));
app.use(express.json({ limit: '30mb' }));
app.use('/uploads', express.static(path.join(config.rootDir, 'uploads')));
app.use('/labeled_images', express.static(labeledImageDir));

function cleanStudentId(value) {
  return String(value || '').trim().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
}

function cleanName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 120);
}

function labelFor(student) {
  return `${student.student_id}_${student.name.replace(/\s+/g, '_')}`;
}

function uploadFolderName(studentId, name) {
  const safeName = name.replace(/[^A-Za-z0-9_-]/g, '_');
  return `${studentId}_${safeName}`;
}

function publicImagePath(filePath) {
  return `/${filePath.replace(/\\/g, '/')}`;
}

async function listStudents() {
  const students = await query(`
    SELECT id, student_id, name, created_at, updated_at
    FROM students
    ORDER BY student_id ASC
  `);

  const images = await query(`
    SELECT id, student_id, file_path, created_at
    FROM student_images
    ORDER BY id ASC
  `);

  const imagesByStudent = new Map();
  for (const image of images) {
    if (!imagesByStudent.has(image.student_id)) imagesByStudent.set(image.student_id, []);
    imagesByStudent.get(image.student_id).push({
      id: image.id,
      url: publicImagePath(image.file_path),
      path: image.file_path,
      createdAt: image.created_at
    });
  }

  return students.map(student => ({
    id: student.id,
    studentId: student.student_id,
    name: student.name,
    label: labelFor(student),
    createdAt: student.created_at,
    updatedAt: student.updated_at,
    images: imagesByStudent.get(student.id) || []
  }));
}

async function saveUploadedImages(studentDbId, studentId, name, images = []) {
  if (!Array.isArray(images) || !images.length) return;

  const folder = uploadFolderName(studentId, name);
  const folderPath = path.join(config.uploadDir, folder);
  fs.mkdirSync(folderPath, { recursive: true });

  for (const [index, image] of images.entries()) {
    if (!image || typeof image.dataUrl !== 'string') continue;

    const match = image.dataUrl.match(/^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/i);
    if (!match) continue;

    const ext = match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase();
    const filename = `${Date.now()}-${index + 1}.${ext}`;
    const absolutePath = path.join(folderPath, filename);
    const relativePath = path.relative(config.rootDir, absolutePath);

    fs.writeFileSync(absolutePath, Buffer.from(match[2], 'base64'));
    await execute('INSERT IGNORE INTO student_images (student_id, file_path) VALUES (?, ?)', [
      studentDbId,
      relativePath
    ]);
  }
}

async function seedFromLabeledImages() {
  if (!fs.existsSync(labeledImageDir)) return;

  for (const entry of fs.readdirSync(labeledImageDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const [studentIdPart, ...nameParts] = entry.name.split('_');
    const studentId = cleanStudentId(studentIdPart);
    const name = cleanName(nameParts.join(' ') || 'Student');
    if (!studentId || !name) continue;

    await execute(
      'INSERT INTO students (student_id, name) VALUES (?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name)',
      [studentId, name]
    );

    const [student] = await query('SELECT id FROM students WHERE student_id = ?', [studentId]);
    if (!student) continue;

    const folderPath = path.join(labeledImageDir, entry.name);
    for (const file of fs.readdirSync(folderPath, { withFileTypes: true })) {
      if (!file.isFile() || !/\.(jpe?g|png|webp)$/i.test(file.name)) continue;

      const relativePath = path.join('labeled_images', entry.name, file.name);
      await execute('INSERT IGNORE INTO student_images (student_id, file_path) VALUES (?, ?)', [
        student.id,
        relativePath
      ]);
    }
  }
}

async function deleteStudentImages(studentId) {
  const images = await query('SELECT file_path FROM student_images WHERE student_id = ?', [studentId]);

  for (const image of images) {
    const absolute = path.resolve(config.rootDir, image.file_path);
    const uploadRoot = path.resolve(config.rootDir, 'uploads');

    if (absolute.startsWith(uploadRoot) && fs.existsSync(absolute)) {
      fs.rmSync(absolute, { force: true });
    }
  }
}

async function getAttendance(date) {
  const params = [];
  let where = '';

  if (date) {
    where = 'WHERE a.attendance_date = ?';
    params.push(date);
  }

  const rows = await query(
    `
      SELECT a.id, s.student_id, s.name, a.status, a.marked_at, a.attendance_date
      FROM attendance a
      JOIN students s ON s.id = a.student_id
      ${where}
      ORDER BY a.marked_at DESC
      LIMIT 300
    `,
    params
  );

  return rows.map(row => ({
    id: row.id,
    studentId: row.student_id,
    name: row.name,
    status: row.status,
    markedAt: row.marked_at,
    date: row.attendance_date
  }));
}

app.get('/api/health', async (_req, res) => {
  await query('SELECT 1');
  res.json({ ok: true });
});

app.get('/api/students', async (_req, res) => {
  res.json({ students: await listStudents() });
});

app.post('/api/students', async (req, res) => {
  const studentId = cleanStudentId(req.body.studentId);
  const name = cleanName(req.body.name);

  if (!studentId || !name) {
    return res.status(400).json({ error: 'Student ID and name are required.' });
  }

  try {
    const result = await execute('INSERT INTO students (student_id, name) VALUES (?, ?)', [studentId, name]);
    await saveUploadedImages(result.insertId, studentId, name, req.body.images);
    const student = (await listStudents()).find(item => item.id === result.insertId);
    res.status(201).json({ student });
  } catch (error) {
    const isDuplicate = error.code === 'ER_DUP_ENTRY';
    res.status(isDuplicate ? 409 : 500).json({ error: isDuplicate ? 'Student ID already exists.' : error.message });
  }
});

app.put('/api/students/:id', async (req, res) => {
  const id = Number(req.params.id);
  const studentId = cleanStudentId(req.body.studentId);
  const name = cleanName(req.body.name);

  if (!id || !studentId || !name) {
    return res.status(400).json({ error: 'Student ID and name are required.' });
  }

  try {
    await execute('UPDATE students SET student_id = ?, name = ? WHERE id = ?', [studentId, name, id]);
    await saveUploadedImages(id, studentId, name, req.body.images);
    const student = (await listStudents()).find(item => item.id === id);
    res.json({ student });
  } catch (error) {
    const isDuplicate = error.code === 'ER_DUP_ENTRY';
    res.status(isDuplicate ? 409 : 500).json({ error: isDuplicate ? 'Student ID already exists.' : error.message });
  }
});

app.delete('/api/students/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid student ID.' });

  await deleteStudentImages(id);
  await execute('DELETE FROM students WHERE id = ?', [id]);
  res.json({ ok: true });
});

app.get('/api/attendance', async (req, res) => {
  res.json({ attendance: await getAttendance(req.query.date) });
});

app.post('/api/attendance', async (req, res) => {
  const studentId = cleanStudentId(req.body.studentId);
  const [student] = await query('SELECT id, student_id, name FROM students WHERE student_id = ?', [studentId]);

  if (!student) return res.status(404).json({ error: 'Student not found.' });

  const now = new Date();
  const markedAt = now.toISOString().slice(0, 19).replace('T', ' ');
  const attendanceDate = now.toISOString().slice(0, 10);

  await execute(
    `
      INSERT INTO attendance (student_id, status, marked_at, attendance_date)
      VALUES (?, 'Present', ?, ?)
      ON DUPLICATE KEY UPDATE status = status
    `,
    [student.id, markedAt, attendanceDate]
  );

  res.json({
    attendance: {
      studentId: student.student_id,
      name: student.name,
      status: 'Present',
      markedAt,
      date: attendanceDate
    }
  });
});

const distDir = path.join(config.rootDir, 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/.*/, (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

async function start() {
  await query('SELECT 1');
  await seedFromLabeledImages();
  app.listen(config.port, () => {
    console.log(`API server running at http://localhost:${config.port}`);
    console.log(`React dev server runs at http://localhost:5173 with npm run dev`);
  });
}

start().catch(error => {
  console.error('Server startup failed:', error.message);
  console.error('Run npm run migrate and check your .env MySQL settings.');
  process.exit(1);
});

process.on('SIGINT', async () => {
  await pool.end();
  process.exit(0);
});
