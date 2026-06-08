import { useEffect, useRef, useState } from 'react';
import { getStudents, markAttendance } from '../api.js';

const MODEL_URL = 'https://cdn.jsdelivr.net/gh/vladmandic/face-api/model';

function waitForFaceApi() {
  return new Promise((resolve, reject) => {
    let tries = 0;
    const timer = window.setInterval(() => {
      if (window.faceapi) {
        window.clearInterval(timer);
        resolve(window.faceapi);
      }

      tries += 1;
      if (tries > 80) {
        window.clearInterval(timer);
        reject(new Error('Face recognition library did not load.'));
      }
    }, 250);
  });
}

export default function Scanner({ onNavigateAdmin }) {
  const videoRef = useRef(null);
  const webcamBoxRef = useRef(null);
  const markedRef = useRef(new Set());
  const streamRef = useRef(null);
  const intervalRef = useRef(null);
  const canvasRef = useRef(null);
  const scanningRef = useRef(false);
  const [status, setStatus] = useState({ message: 'Click Start Scanner when you are ready.', type: 'idle' });
  const [rows, setRows] = useState([]);
  const [isStarting, setIsStarting] = useState(false);

  useEffect(() => () => stopScanner(), []);

  async function startScanner() {
    if (isStarting || scanningRef.current) return;

    setIsStarting(true);
    setStatus({ message: 'Loading face recognition models...', type: 'idle' });

    try {
      const faceapi = await waitForFaceApi();
      await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
      setStatus({ message: 'Loading face landmarks...', type: 'idle' });
      await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
      setStatus({ message: 'Loading face recognition...', type: 'idle' });
      await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);

      streamRef.current = await navigator.mediaDevices.getUserMedia({ video: {} });
      videoRef.current.srcObject = streamRef.current;
      setStatus({ message: 'Camera ready. Loading students...', type: 'idle' });

      await new Promise(resolve => {
        videoRef.current.onloadedmetadata = resolve;
      });

      const { descriptors, studentsByLabel } = await loadDescriptors(faceapi);
      if (!descriptors.length) {
        setStatus({ message: 'No trained student images found. Add students in Admin.', type: 'error' });
        stopScanner();
        return;
      }

      canvasRef.current = faceapi.createCanvasFromMedia(videoRef.current);
      webcamBoxRef.current.append(canvasRef.current);

      let displaySize = { width: videoRef.current.clientWidth, height: videoRef.current.clientHeight };
      faceapi.matchDimensions(canvasRef.current, displaySize);

      const matcher = new faceapi.FaceMatcher(descriptors, 0.6);
      let detectionInProgress = false;
      scanningRef.current = true;
      setStatus({ message: 'Scanning active', type: 'success' });

      intervalRef.current = window.setInterval(async () => {
        if (detectionInProgress || !videoRef.current || !canvasRef.current) return;
        detectionInProgress = true;

        try {
          const detections = await faceapi.detectAllFaces(videoRef.current, new faceapi.TinyFaceDetectorOptions())
            .withFaceLandmarks()
            .withFaceDescriptors();

          displaySize = { width: videoRef.current.clientWidth, height: videoRef.current.clientHeight };
          faceapi.matchDimensions(canvasRef.current, displaySize);
          const resized = faceapi.resizeResults(detections, displaySize);

          canvasRef.current.getContext('2d').clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
          faceapi.draw.drawDetections(canvasRef.current, resized);

          for (const detection of resized) {
            const result = matcher.findBestMatch(detection.descriptor);
            const student = studentsByLabel.get(result.label);

            if (student && !markedRef.current.has(student.studentId)) {
              saveAttendance(student);
            }
          }
        } finally {
          detectionInProgress = false;
        }
      }, 1000);
    } catch (error) {
      console.error(error);
      stopScanner();
      setStatus({ message: error.message || 'Scanner could not start.', type: 'error' });
    } finally {
      setIsStarting(false);
    }
  }

  function stopScanner() {
    scanningRef.current = false;

    if (intervalRef.current) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    canvasRef.current?.remove();
    canvasRef.current = null;
  }

  async function loadDescriptors(faceapi) {
    const { students } = await getStudents();
    const studentsByLabel = new Map(students.map(student => [student.label, student]));
    const descriptors = [];

    for (const student of students) {
      const descriptions = [];
      setStatus({ message: `Training ${student.name}...`, type: 'idle' });

      for (const image of student.images) {
        try {
          const img = await faceapi.fetchImage(image.url);
          const detection = await faceapi
            .detectSingleFace(img, new faceapi.TinyFaceDetectorOptions())
            .withFaceLandmarks()
            .withFaceDescriptor();

          if (detection) descriptions.push(detection.descriptor);
        } catch (error) {
          console.error(`Could not train ${student.label}`, error);
        }

        await new Promise(resolve => window.setTimeout(resolve, 20));
      }

      if (descriptions.length) {
        descriptors.push(new faceapi.LabeledFaceDescriptors(student.label, descriptions));
      }
    }

    return { descriptors, studentsByLabel };
  }

  async function saveAttendance(student) {
    markedRef.current.add(student.studentId);

    try {
      await markAttendance(student.studentId);
      setRows(current => [{
        studentId: student.studentId,
        name: student.name,
        status: 'Present',
        markedAt: new Date().toISOString()
      }, ...current]);
      setStatus({ message: `Attendance marked for ${student.name}`, type: 'success' });
      window.setTimeout(() => setStatus({ message: 'Scanning active', type: 'success' }), 3000);
    } catch (error) {
      markedRef.current.delete(student.studentId);
      setStatus({ message: error.message, type: 'error' });
    }
  }

  return (
    <>
      <section className="glass-card video-container">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Live Scanner</p>
            <h1>AI Smart Attendance</h1>
          </div>
          <button className="button secondary" type="button" onClick={onNavigateAdmin}>Admin</button>
        </div>
        <div className="webcam-box" ref={webcamBoxRef}>
          {!scanningRef.current && (
            <div className="scanner-placeholder">
              <button className="button primary scanner-start" type="button" onClick={startScanner} disabled={isStarting}>
                {isStarting ? 'Starting...' : 'Start Scanner'}
              </button>
            </div>
          )}
          <video ref={videoRef} autoPlay muted playsInline width="600" height="450" />
        </div>
        <div className="status" data-type={status.type}>{status.message}</div>
      </section>

      <section className="glass-card log-container">
        <h2>Attendance Log</h2>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Student ID</th>
                <th>Name</th>
                <th>Status</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? rows.map(row => (
                <tr key={`${row.studentId}-${row.markedAt}`}>
                  <td><strong>{row.studentId}</strong></td>
                  <td>{row.name}</td>
                  <td><span className="badge-present">{row.status}</span></td>
                  <td>{new Date(row.markedAt).toLocaleTimeString()}</td>
                </tr>
              )) : (
                <tr><td className="empty" colSpan="4">No attendance marked in this session.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
