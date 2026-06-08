const jsonHeaders = { 'Content-Type': 'application/json' };

async function request(path, options = {}) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || 'Request failed.');
  }

  return data;
}

export function getStudents() {
  return request('/api/students');
}

export function createStudent(payload) {
  return request('/api/students', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(payload)
  });
}

export function updateStudent(id, payload) {
  return request(`/api/students/${id}`, {
    method: 'PUT',
    headers: jsonHeaders,
    body: JSON.stringify(payload)
  });
}

export function deleteStudent(id) {
  return request(`/api/students/${id}`, { method: 'DELETE' });
}

export function getAttendance(date) {
  return request(`/api/attendance${date ? `?date=${date}` : ''}`);
}

export function markAttendance(studentId) {
  return request('/api/attendance', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ studentId })
  });
}

export function filesToDataUrls(files) {
  return Promise.all(Array.from(files || []).map(file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ filename: file.name, dataUrl: reader.result });
    reader.onerror = reject;
    reader.readAsDataURL(file);
  })));
}
