import { useState, useCallback, useEffect, useRef } from "react";
import "./App.css";

import SplashScreen       from "./components/SplashScreen";
import InstructionsScreen from "./components/InstructionsScreen";
import ScanScreen         from "./components/ScanScreen";
import ProcessingScreen   from "./components/ProcessingScreen";
import ResultScreen       from "./components/ResultScreen";
import HistoryScreen      from "./components/HistoryScreen";
import DashboardScreen    from "./components/DashboardScreen";

let scanCounter = 0;
const INACTIVITY_TIMEOUT_MS = 60_000;

function clearSessionData() {
  delete window.__siglaani_captured_image__;
  delete window.__siglaani_capture__;
  delete window.__siglaani_fruit_name__;
  delete window.__siglaani_scientific__;
  delete window.__siglaani_hsv_key__;
  delete window.__siglaani_class_condition__;
  delete window.__siglaani_bbox__;
  delete window.__siglaani_fruits_payload__;
  delete window.__siglaani_cart__;
}

export default function App() {
  const [screen,     setScreen]     = useState("splash");
  const [result,     setResult]     = useState([]);
  const [scanId,     setScanId]     = useState(0);
  const [prevScreen, setPrevScreen] = useState("splash");

  const inactivityRef = useRef(null);

  const go = useCallback((s) => setScreen(s), []);

  const goHistory = useCallback(() => {
    setPrevScreen(screen);
    setScreen("history");
  }, [screen]);

  const goDashboard = useCallback(() => {
    setPrevScreen(screen);
    setScreen("dashboard");
  }, [screen]);

  const handleInactivityTimeout = useCallback(() => {
    clearSessionData();
    setResult([]);
    setScanId(0);
    setPrevScreen("splash");
    setScreen("splash");
  }, []);

  useEffect(() => {
    if (screen === "splash") {
      if (inactivityRef.current) {
        clearTimeout(inactivityRef.current);
        inactivityRef.current = null;
      }
      return;
    }

    const reset = () => {
      if (inactivityRef.current) clearTimeout(inactivityRef.current);
      inactivityRef.current = setTimeout(handleInactivityTimeout, INACTIVITY_TIMEOUT_MS);
    };

    const events = ["mousedown", "mousemove", "keydown", "touchstart", "click", "scroll"];
    events.forEach(e => window.addEventListener(e, reset, { passive: true }));
    reset();

    return () => {
      events.forEach(e => window.removeEventListener(e, reset));
      if (inactivityRef.current) {
        clearTimeout(inactivityRef.current);
        inactivityRef.current = null;
      }
    };
  }, [screen, handleInactivityTimeout]);

  const handleProcessingComplete = useCallback((finalResults) => {
    scanCounter++;
    
    let resArray = [];
    if (Array.isArray(finalResults) && finalResults.length > 0) {
      resArray = finalResults;
    } else if (finalResults?.results && Array.isArray(finalResults.results)) {
      resArray = finalResults.results;
    } else if (finalResults && typeof finalResults === 'object') {
      resArray = [finalResults];
    }

    setResult(resArray);
    setScanId(resArray[0]?.transaction_id || resArray[0]?.id || scanCounter);
    go("result");
  }, [go]);

  const handleHome = useCallback(() => {
    clearSessionData();
    setResult([]);
    setScanId(0);
    go("splash");
  }, [go]);

  return (
    <div className="app-root">
      <div className="app-shell">
        {screen === "splash"     && <SplashScreen onStart={() => go("instr1")} onDashboard={goDashboard}/>}
        {screen === "instr1"     && <InstructionsScreen page={1} onNext={() => go("instr2")} onBack={() => go("splash")}/>}
        {screen === "instr2"     && <InstructionsScreen page={2} onNext={() => go("scan")}   onBack={() => go("instr1")}/>}
        {screen === "scan"       && <ScanScreen onScan={() => go("processing")} onHistory={goHistory}/>}
        {screen === "processing" && <ProcessingScreen onComplete={handleProcessingComplete}/>}
        {screen === "result"     && <ResultScreen result={result} scanId={scanId} onScanAgain={() => go("scan")} onHome={handleHome} onHistory={goHistory} onDashboard={goDashboard}/>}
        {screen === "history"    && <HistoryScreen onBack={() => go(prevScreen || "splash")} onScanAgain={() => go("scan")}/>}
        {screen === "dashboard"  && <DashboardScreen onBack={() => go(prevScreen || "splash")}/>}
      </div>
    </div>
  );
}