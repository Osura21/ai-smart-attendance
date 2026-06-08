import { useEffect, useRef, useState } from 'react';
import { getStudents, markAttendance } from '../api.js';

const MODEL_URL = '/model';
const LIVE_DETECTION_OPTIONS = { inputSize: 224, scoreThreshold: 0.3 };
const TRAINING_DETECTION_OPTIONS = { inputSize: 320, scoreThreshold: 0.25 };
const DESCRIPTOR_CACHE_KEY = 'face-attendance-descriptors-v3';
let faceApiPromise;
let modelsPromise;

function loadFaceApi() {
  if (window.faceapi) return Promise.resolve(window.faceapi);

  if (!faceApiPromise) {
    faceApiPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '/vendor/face-api.js';
      script.async = true;
      script.onload = () => {
        if (window.faceapi) {
          resolve(window.faceapi);
        } else {
          reject(new Error('Face recognition library loaded, but did not initialize.'));
        }
      };
      script.onerror = () => reject(new Error('Could not load local face recognition library.'));
      document.head.appendChild(script);
    });
  }

  return faceApiPromise;
}

function withTimeout(promise, message, timeoutMs = 20000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => window.setTimeout(() => reject(new Error(message)), timeoutMs))
  ]);
}

function descriptorCacheKey(students) {
  return JSON.stringify(students.map(student => ({
    id: student.id,
    studentId: student.studentId,
    name: student.name,
    updatedAt: student.updatedAt,
    images: student.images.map(image => `${image.id}:${image.path}:${image.createdAt}`)
  })));
}

function readDescriptorCache(faceapi, cacheKey) {
  try {
    const cached = JSON.parse(localStorage.getItem(DESCRIPTOR_CACHE_KEY) || 'null');
    if (!cached || cached.cacheKey !== cacheKey || !Array.isArray(cached.items)) return null;

    return cached.items.map(item => new faceapi.LabeledFaceDescriptors(
      item.label,
      item.descriptions.map(values => new Float32Array(values))
    ));
  } catch {
    return null;
  }
}

function writeDescriptorCache(cacheKey, descriptors) {
  try {
    localStorage.setItem(DESCRIPTOR_CACHE_KEY, JSON.stringify({
      cacheKey,
      items: descriptors.map(item => ({
        label: item.label,
        descriptions: item.descriptors.map(descriptor => Array.from(descriptor))
      }))
    }));
  } catch {
    localStorage.removeItem(DESCRIPTOR_CACHE_KEY);
  }
}

export default function Scanner({ onNavigateAdmin }) {
  const videoRef = useRef(null);
  const webcamBoxRef = useRef(null);
  const markedRef = useRef(new Set());
  const streamRef = useRef(null);
  const intervalRef = useRef(null);
  const canvasRef = useRef(null);
  const scanningRef = useRef(false);
  const lastStatusAtRef = useRef(0);
  const [status, setStatus] = useState({ message: 'Click Start Scanner when you are ready.', type: 'idle' });
  const [rows, setRows] = useState([]);
  const [isStarting, setIsStarting] = useState(false);

  useEffect(() => () => stopScanner(), []);

  async function startScanner() {
    if (isStarting || scanningRef.current) return;

    setIsStarting(true);
    setStatus({ message: 'Loading face recognition models...', type: 'idle' });

    try {
      const faceapi = await withTimeout(loadFaceApi(), 'Face recognition library loading is taking too long.');
      await loadModels(faceapi);

      streamRef.current = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640, max: 640 },
          height: { ideal: 480, max: 480 },
          frameRate: { ideal: 15, max: 20 }
        }
      });
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

      const matcher = new faceapi.FaceMatcher(descriptors, 0.72);
      let detectionInProgress = false;
      scanningRef.current = true;
      setStatus({ message: 'Scanning active', type: 'success' });

      const runDetection = async () => {
        if (!scanningRef.current) return;
        if (detectionInProgress || !videoRef.current || !canvasRef.current) {
          intervalRef.current = window.setTimeout(runDetection, 450);
          return;
        }

        detectionInProgress = true;

        try {
          const detection = await faceapi.detectSingleFace(videoRef.current, new faceapi.TinyFaceDetectorOptions(LIVE_DETECTION_OPTIONS))
            .withFaceLandmarks(true)
            .withFaceDescriptor();

          displaySize = { width: videoRef.current.clientWidth, height: videoRef.current.clientHeight };
          faceapi.matchDimensions(canvasRef.current, displaySize);

          canvasRef.current.getContext('2d').clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);

          if (detection) {
            const resized = faceapi.resizeResults(detection, displaySize);
            faceapi.draw.drawDetections(canvasRef.current, [resized]);

            const result = matcher.findBestMatch(detection.descriptor);
            const student = studentsByLabel.get(result.label);

            if (student && !markedRef.current.has(student.studentId)) {
              saveAttendance(student);
            } else {
              updateScanStatus(result.label === 'unknown' ? 'Face detected, no match yet.' : `Detected ${result.label}`);
            }
          } else {
            updateScanStatus('Scanning active');
          }
        } catch (error) {
          console.error('Scan failed:', error);
          updateScanStatus(`Scan error: ${error.message || 'detection failed'}`);
        } finally {
          detectionInProgress = false;
          intervalRef.current = window.setTimeout(runDetection, 550);
        }
      };

      intervalRef.current = window.setTimeout(runDetection, 250);
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
      window.clearTimeout(intervalRef.current);
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

  async function loadModels(faceapi) {
    if (!modelsPromise) {
      modelsPromise = (async () => {
        setStatus({ message: 'Starting browser AI backend...', type: 'idle' });
        await withTimeout(faceapi.tf.setBackend('cpu'), 'Could not start the browser AI backend.');
        await faceapi.tf.ready();

        setStatus({ message: 'Loading face detector...', type: 'idle' });
        await withTimeout(faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL), 'Face detector model loading is taking too long.');

        setStatus({ message: 'Loading face landmarks...', type: 'idle' });
        await withTimeout(faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL), 'Face landmark model loading is taking too long.');

        setStatus({ message: 'Loading face recognition...', type: 'idle' });
        await withTimeout(faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL), 'Face recognition model loading is taking too long.');
      })();
    }

    await modelsPromise;
  }

  function updateScanStatus(message) {
    const now = Date.now();
    if (now - lastStatusAtRef.current < 1200) return;
    lastStatusAtRef.current = now;
    setStatus({ message, type: message === 'Scanning active' ? 'success' : 'idle' });
  }

  async function loadDescriptors(faceapi) {
    const { students } = await getStudents();
    const studentsByLabel = new Map(students.map(student => [student.label, student]));
    const cacheKey = descriptorCacheKey(students);
    const cachedDescriptors = readDescriptorCache(faceapi, cacheKey);

    if (cachedDescriptors?.length) {
      setStatus({ message: 'Using cached face training data...', type: 'idle' });
      return { descriptors: cachedDescriptors, studentsByLabel };
    }

    const descriptors = [];

    for (const student of students) {
      const descriptions = [];
      setStatus({ message: `Training ${student.name}...`, type: 'idle' });

      for (const image of student.images) {
        try {
          const img = await faceapi.fetchImage(image.url);
          const detection = await faceapi
            .detectSingleFace(img, new faceapi.TinyFaceDetectorOptions(TRAINING_DETECTION_OPTIONS))
            .withFaceLandmarks(true)
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

    if (descriptors.length) writeDescriptorCache(cacheKey, descriptors);
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
