import { useState, useEffect, useRef } from 'react';
import * as cocoSsd from '@tensorflow-models/coco-ssd';
import * as tmImage from '@teachablemachine/image';
import Topbar from './shared/Topbar';
import FruitBall from './shared/FruitBall';
import { COCO_FRUIT_LABELS } from '../constants';

export default function ScanScreen({ onScan, onHistory }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const cocoRef = useRef(null);
  const mnetRef = useRef(null);
  const streamRef = useRef(null);
  const loopRef = useRef(null);
  const mnetLoopRef = useRef(null);
  const timerRef = useRef(null);
  const detectStart = useRef(null);

  const latestBoxesRef = useRef([]);
  const activeFruitRef = useRef(null);

  const [status, setStatus] = useState("loading");
  const [loadMsg, setLoadMsg] = useState("Starting camera...");
  const [countdown, setCountdown] = useState(3);
  const [activeFruit, setActiveFruit] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: 640, height: 480 },
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await new Promise(res => (videoRef.current.onloadedmetadata = res));
          videoRef.current.play();
        }
      } catch {
        if (!cancelled) setStatus("error");
        return;
      }

      if (!cancelled) setLoadMsg("Loading detection model...");
      const coco = await cocoSsd.load({ base: "lite_mobilenet_v2" });
      if (cancelled) return;
      cocoRef.current = coco;

      if (!cancelled) setLoadMsg("Loading classification model...");
      const URL = "/custom_model/";
      const mnet = await tmImage.load(URL + "model.json", URL + "metadata.json");
      if (cancelled) return;
      mnetRef.current = mnet;

      setStatus("scanning");
      runCocoLoop();
      runMobileNetLoop();
    };
    init();

    return () => {
      cancelled = true;
      clearInterval(timerRef.current);
      clearTimeout(loopRef.current);
      clearTimeout(mnetLoopRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    };
  }, []);

  const runCocoLoop = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const coco = cocoRef.current;

    if (!video || !canvas || !coco || video.readyState < 2) {
      loopRef.current = setTimeout(runCocoLoop, 200);
      return;
    }

    try {
      const preds = await coco.detect(video);
      drawBoxes(preds, canvas, video);
    } catch (e) {
      console.warn(e);
    }
    loopRef.current = setTimeout(runCocoLoop, 150);
  };

  const runMobileNetLoop = async () => {
    const video = videoRef.current;
    const mnet = mnetRef.current;

    if (!video || !mnet || video.readyState < 2) {
      mnetLoopRef.current = setTimeout(runMobileNetLoop, 400);
      return;
    }

    try {
      const preds = await mnet.predict(video);

      const nonBg = preds
        .filter(p => p.className.toLowerCase() !== "background")
        .sort((a, b) => b.probability - a.probability);

      let topPred = null;

      if (nonBg.length > 0 && nonBg[0].probability > 0.35) {
        const top = nonBg[0];
        const rawClass = top.className.trim();
        const lower = rawClass.toLowerCase();

        let fruitName = "Banana";
        if (lower.includes("banana") || lower.includes("saging")) {
          fruitName = "Banana";
        } else if (lower.includes("apple") || lower.includes("mansanas")) {
          fruitName = "Apple";
        } else if (lower.includes("orange") || lower.includes("dalandan")) {
          fruitName = "Orange";
        } else {
          fruitName = rawClass.charAt(0).toUpperCase() + rawClass.slice(1);
        }

        const isRotten = lower.includes("rotten") || lower.includes("bulok");
        const condition = isRotten ? "rotten" : "ripe";

        topPred = {
          fruit: fruitName,
          condition: condition,
          confidence: Math.round(top.probability * 100)
        };
      }

      activeFruitRef.current = topPred;
      setActiveFruit(topPred);

      if (topPred || (latestBoxesRef.current && latestBoxesRef.current.length > 0)) {
        if (!detectStart.current) {
          detectStart.current = Date.now();
          let secs = 3;
          setCountdown(secs);
          timerRef.current = setInterval(() => {
            secs -= 1;
            setCountdown(secs);
            if (secs <= 0) {
              clearInterval(timerRef.current);
              captureAndProceed();
            }
          }, 1000);
        }
      } else {
        if (detectStart.current) {
          detectStart.current = null;
          clearInterval(timerRef.current);
          setCountdown(3);
        }
      }
    } catch (e) {
      console.warn("MobileNet prediction error:", e);
    }
    mnetLoopRef.current = setTimeout(runMobileNetLoop, 600);
  };

  const drawBoxes = (preds, canvas, video) => {
    const rect = video.getBoundingClientRect();
    canvas.width = rect.width || video.videoWidth;
    canvas.height = rect.height || video.videoHeight;
    const ctx = canvas.getContext("2d");
    const scaleX = canvas.width / video.videoWidth;
    const scaleY = canvas.height / video.videoHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const fruitPreds = preds.filter(pred => {
      const name = pred.class.toLowerCase();
      return (
        COCO_FRUIT_LABELS.includes(name) ||
        ['apple', 'banana', 'orange'].includes(name)
      ) && pred.score > 0.20;
    });

    latestBoxesRef.current = fruitPreds;

    fruitPreds.forEach(pred => {
      const [x, y, w, h] = pred.bbox;
      const sx = x * scaleX, sy = y * scaleY;
      const sw = w * scaleX, sh = h * scaleY;
      const conf = Math.round(pred.score * 100);

      ctx.strokeStyle = "#7ee84a";
      ctx.lineWidth = 2;
      ctx.strokeRect(sx, sy, sw, sh);

      const label = `${pred.class.toUpperCase()} ${conf}%`;
      ctx.font = "bold 12px Nunito, sans-serif";
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = "#7ee84a";
      ctx.fillRect(sx, sy - 22, tw + 14, 20);
      ctx.fillStyle = "#0b1f0d";
      ctx.fillText(label, sx + 7, sy - 7);
    });
  };

  const captureAndProceed = async () => {
    const video = videoRef.current;
    const mnet = mnetRef.current;
    if (!video || video.videoWidth === 0) return;

    const vw = video.videoWidth;
    const vh = video.videoHeight;

    const canvas = document.createElement("canvas");
    canvas.width = vw;
    canvas.height = vh;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, vw, vh);
    const base64Image = canvas.toDataURL("image/jpeg");

    const boxes = latestBoxesRef.current || [];
    const topFruit = activeFruitRef.current;

    let fruitsPayload = [];

    if (boxes.length > 0 && mnet) {
      // Classify EACH detected bounding box crop individually
      for (const p of boxes) {
        const [x, y, w, h] = p.bbox;
        const padX = w * 0.15;
        const padY = h * 0.15;
        const sx = Math.max(0, x - padX);
        const sy = Math.max(0, y - padY);
        const sw = Math.min(vw - sx, w + padX * 2);
        const sh = Math.min(vh - sy, h + padY * 2);

        let fruitCondition = "ripe";
        let fruitConfidence = Math.round(p.score * 100);

        if (sw > 20 && sh > 20) {
          const cropCanvas = document.createElement("canvas");
          cropCanvas.width = sw;
          cropCanvas.height = sh;
          const cropCtx = cropCanvas.getContext("2d");
          cropCtx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);

          try {
            const cropPreds = await mnet.predict(cropCanvas);
            const sortedCrop = cropPreds
              .filter(cp => cp.className.toLowerCase() !== "background")
              .sort((a, b) => b.probability - a.probability);

            if (sortedCrop.length > 0) {
              const best = sortedCrop[0];
              const bestLabel = best.className.toLowerCase();
              fruitCondition = bestLabel.includes("rotten") ? "rotten" : "ripe";
              fruitConfidence = Math.round(best.probability * 100);
            }
          } catch (e) {
            console.warn("Crop prediction error:", e);
          }
        }

        const rawClass = p.class.toLowerCase();
        let name = "Banana";
        if (rawClass.includes("banana") || rawClass.includes("saging")) name = "Banana";
        else if (rawClass.includes("apple") || rawClass.includes("mansanas")) name = "Apple";
        else if (rawClass.includes("orange") || rawClass.includes("dalandan")) name = "Orange";
        else name = p.class.charAt(0).toUpperCase() + p.class.slice(1);

        fruitsPayload.push({
          detected_fruit: name,
          bbox: p.bbox,
          model_condition: fruitCondition,
          model_confidence: fruitConfidence
        });
      }
    } else if (topFruit) {
      fruitsPayload = [{
        detected_fruit: topFruit.fruit,
        bbox: null,
        model_condition: topFruit.condition,
        model_confidence: topFruit.confidence
      }];
    }

    window.__siglaani_captured_image__ = base64Image;
    window.__siglaani_fruits_payload__ = fruitsPayload;

    if (typeof onScan === "function") {
      onScan();
    }
  };

  return (
    <div className="screen scan-screen">
      <Topbar right={status === "loading" ? loadMsg : "Live Scanning"} onHistory={onHistory} showHistoryBtn />
      <div className="scan-wrap">
        <div className="scan-viewfinder">
          <div className="vf-corner tl"/><div className="vf-corner tr"/>
          <div className="vf-corner bl"/><div className="vf-corner br"/>

          {status === "error" ? (
            <div className="cam-fallback">
              <FruitBall size={180}/>
              <div className="cam-err-badge">No camera detected</div>
            </div>
          ) : (
            <>
              <video ref={videoRef} autoPlay playsInline muted style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 14, display: "block" }}/>
              <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", borderRadius: 14, pointerEvents: "none" }}/>
            </>
          )}

          {(activeFruit || latestBoxesRef.current.length > 0) && status === "scanning" && (
            <div className="scan-countdown-wrap">
              <svg width="70" height="70" viewBox="0 0 70 70">
                <circle cx="35" cy="35" r="30" fill="rgba(0,0,0,0.55)" stroke="rgba(255,255,255,0.08)" strokeWidth="4"/>
                <circle cx="35" cy="35" r="30" fill="none" stroke="#7ee84a" strokeWidth="4" strokeDasharray={`${((3 - countdown) / 3) * 188} 188`} strokeLinecap="round" transform="rotate(-90 35 35)" style={{ transition: "stroke-dasharray 0.9s linear" }}/>
                <text x="35" y="42" textAnchor="middle" fill="#fff" fontSize="22" fontWeight="800" fontFamily="Nunito, sans-serif">{countdown}</text>
              </svg>
            </div>
          )}
        </div>

        <div className="scan-panel">
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div className="scan-info-title">
              {latestBoxesRef.current.length > 0 
                ? `${latestBoxesRef.current.length} Prutas ang Nakita`
                : (activeFruit ? `Detected: ${activeFruit.fruit} (${activeFruit.confidence}%)` : "Handa na ba?")}
            </div>
            <div className="scan-info-body">
              Panatilihin ang mga prutas sa loob ng frame para sa indibidwal na pagsusuri.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}