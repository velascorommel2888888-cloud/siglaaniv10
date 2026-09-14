import { useState, useEffect } from 'react';
import logo from '../logo.png';
import Topbar from './shared/Topbar';
import { apiScan } from '../api';

const PROC_STEPS = [
  "Kinukuha ang larawan",
  "Sinusuri ang bawat prutas",
  "Nagpapatakbo ng AI model",
  "Naghahanda ng resibo...",
];
const MILESTONES = [25, 55, 80, 100];

export default function ProcessingScreen({ onComplete }) {
  const [progress, setProgress] = useState(0);
  const [stepIdx,  setStepIdx]  = useState(0);

  useEffect(() => {
    let finalResults = [];
    let apiFinished = false;

    const processBatch = async () => {
      try {
        const image = window.__siglaani_captured_image__;
        const fruits = window.__siglaani_fruits_payload__ || [];

        const payload = {
          image: image,
          fruits: fruits
        };

        const res = await apiScan(payload);

        // Handle both direct JSON and Axios responses safely
        if (res) {
          if (res.results && Array.isArray(res.results)) {
            finalResults = res.results;
          } else if (Array.isArray(res)) {
            finalResults = res;
          } else if (res.data?.results && Array.isArray(res.data.results)) {
            finalResults = res.data.results;
          } else if (res.data) {
            finalResults = [res.data];
          } else {
            finalResults = [res];
          }
        }
      } catch (err) {
        console.error("Batch processing error:", err);
      } finally {
        apiFinished = true;
      }
    };

    processBatch();

    let p = 0, si = 0;
    const iv = setInterval(() => {
      if (p >= 95 && !apiFinished) {
        p = 95;
      } else {
        p += Math.random() * 8 + 3;
      }

      if (p > 100) p = 100;
      setProgress(Math.round(p));

      if (si < MILESTONES.length && p >= MILESTONES[si]) {
        si++;
        setStepIdx(si);
      }

      if (p >= 100 && apiFinished) {
        clearInterval(iv);
        setTimeout(() => onComplete(finalResults), 300);
      }
    }, 40);

    return () => clearInterval(iv);
  }, [onComplete]);

  return (
    <div className="screen processing-screen">
      <Topbar right="Nagpo-proseso..."/>
      <div className="proc-wrap">
        <div className="proc-scanner">
          <div className="proc-scanline"/>
          <img src={logo} alt="logo" width="90" height="90" style={{ objectFit: "contain", opacity: 0.7 }}/>
        </div>
        <div className="proc-info">
          <div className="proc-label">Sinusuri...</div>
          <div className="proc-sub">{PROC_STEPS[Math.min(stepIdx, 3)]}</div>
          <div className="proc-bar-wrap">
            <div className="proc-bar-fill" style={{ width: `${progress}%` }}/>
          </div>
          <div className="proc-pct">{progress}%</div>
          <div className="proc-steps">
            {PROC_STEPS.map((s, i) => (
              <div key={i} className={`proc-step-item ${i < stepIdx ? "done" : i === stepIdx ? "active" : ""}`}>
                <div className="proc-step-dot"/>{s}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}