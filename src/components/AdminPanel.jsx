import { useEffect, useState } from 'react';
import {
  createStudent,
  deleteStudent,
  filesToDataUrls,
  getAttendance,
  getStudents,
  updateStudent
} from '../api.js';

const emptyForm = { id: '', studentId: '', name: '', files: null };

export default function AdminPanel({ onNavigateScanner }) {
  const [students, setStudents] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [attendanceDate, setAttendanceDate] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [message, setMessage] = useState('');

  async function loadStudents() {
    const data = await getStudents();
    setStudents(data.students || []);
  }

  async function loadAttendance(date = attendanceDate) {
    const data = await getAttendance(date);
    setAttendance(data.attendance || []);
  }

  useEffect(() => {
    loadStudents().catch(error => setMessage(error.message));
    loadAttendance('').catch(error => setMessage(error.message));
  }, []);

  async function submitStudent(event) {
    event.preventDefault();
    setMessage('Saving...');

    try {
      const payload = {
        studentId: form.studentId,
        name: form.name,
        images: await filesToDataUrls(form.files)
      };

      if (form.id) {
        await updateStudent(form.id, payload);
      } else {
        await createStudent(payload);
      }

      setMessage('Student saved.');
      setForm(emptyForm);
      event.target.reset();
      await loadStudents();
    } catch (error) {
      setMessage(error.message);
    }
  }

  function editStudent(student) {
    setForm({ id: student.id, studentId: student.studentId, name: student.name, files: null });
    setMessage('Add more images if you want to improve training.');
  }

  async function removeStudent(student) {
    if (!window.confirm(`Delete ${student.name} and their attendance records?`)) return;

    await deleteStudent(student.id);
    await loadStudents();
    await loadAttendance();
  }

  async function changeAttendanceDate(event) {
    const nextDate = event.target.value;
    setAttendanceDate(nextDate);
    await loadAttendance(nextDate);
  }

  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">Admin Panel</p>
          <h1>Student & Attendance Management</h1>
        </div>
        <nav className="nav-actions">
          <button className="button secondary" type="button" onClick={onNavigateScanner}>Scanner</button>
        </nav>
      </header>

      <section className="admin-grid">
        <form className="panel" onSubmit={submitStudent}>
          <div className="panel-heading">
            <h2>{form.id ? 'Edit Student' : 'Add Student'}</h2>
            <button className="button secondary" type="button" onClick={() => {
              setForm(emptyForm);
              setMessage('');
            }}>Clear</button>
          </div>

          <label>
            Student ID
            <input
              value={form.studentId}
              onChange={event => setForm(current => ({ ...current, studentId: event.target.value }))}
              required
              placeholder="ST004"
            />
          </label>

          <label>
            Name
            <input
              value={form.name}
              onChange={event => setForm(current => ({ ...current, name: event.target.value }))}
              required
              placeholder="Student name"
            />
          </label>

          <label>
            Face Images
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={event => setForm(current => ({ ...current, files: event.target.files }))}
            />
          </label>

          <p className="hint">Use clear front-facing images for best recognition accuracy.</p>
          <button className="button primary" type="submit">Save Student</button>
          <p className="message">{message}</p>
        </form>

        <section className="panel">
          <div className="panel-heading">
            <h2>Students</h2>
            <button className="button secondary" type="button" onClick={loadStudents}>Refresh</button>
          </div>

          <div className="student-list">
            {students.length ? students.map(student => (
              <article className="student-item" key={student.id}>
                <div className="student-info">
                  <div className="avatar-strip">
                    {student.images.slice(0, 3).map(image => (
                      <img src={image.url} alt={student.name} key={image.id} />
                    ))}
                  </div>
                  <div>
                    <strong>{student.studentId}</strong>
                    <span>{student.name}</span>
                    <small>{student.images.length} image{student.images.length === 1 ? '' : 's'}</small>
                  </div>
                </div>
                <div className="row-actions">
                  <button className="button secondary" type="button" onClick={() => editStudent(student)}>Edit</button>
                  <button className="button danger" type="button" onClick={() => removeStudent(student)}>Delete</button>
                </div>
              </article>
            )) : (
              <p className="empty">No students found.</p>
            )}
          </div>
        </section>
      </section>

      <section className="panel attendance-panel">
        <div className="panel-heading">
          <h2>Attendance Records</h2>
          <input type="date" value={attendanceDate} onChange={changeAttendanceDate} />
        </div>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Student ID</th>
                <th>Name</th>
                <th>Status</th>
                <th>Date</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {attendance.length ? attendance.map(record => (
                <tr key={record.id}>
                  <td><strong>{record.studentId}</strong></td>
                  <td>{record.name}</td>
                  <td><span className="badge-present">{record.status}</span></td>
                  <td>{record.date}</td>
                  <td>{new Date(record.markedAt).toLocaleTimeString()}</td>
                </tr>
              )) : (
                <tr><td className="empty" colSpan="5">No attendance records found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
