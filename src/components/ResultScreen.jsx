import { useState, useEffect, useMemo } from 'react';
import LeafSVG from './shared/LeafSVG';
import { 
  FaUndo, FaHome, FaChevronLeft, FaChevronRight, 
  FaQrcode, FaList, FaCartPlus, FaCheck, FaShoppingBag, 
  FaTrash, FaTimes 
} from 'react-icons/fa';
import { apiCheckout } from '../api';

const LIKERT = [
  { stars: 1, label: "Hindi Nakakain", color: "#ef5350" },
  { stars: 2, label: "Medyo Luma",    color: "#f97316" },
  { stars: 3, label: "Katamtaman",   color: "#f9a825" },
  { stars: 4, label: "Sariwa",       color: "#66bb6a" },
  { stars: 5, label: "Napakasariwa", color: "#5cb83a" },
];

const DEFAULT_RATES = {
  apple: 140,
  banana: 75,
  orange: 120,
};

function StarRating({ rating = 3 }) {
  const safeRating = Math.min(Math.max(Number(rating) || 3, 1), 5);
  const info = LIKERT[safeRating - 1];
  return (
    <div className="star-rating-wrap">
      <div className="star-row">
        {[1, 2, 3, 4, 5].map(n => (
          <svg key={n} width="28" height="28" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 2l2.9 6.1L22 9.3l-5 4.9 1.2 6.8L12 17.8l-6.2 3.2L7 14.2 2 9.3l6.5-.5L12 2z"
              fill={n <= safeRating ? info.color : "rgba(0,0,0,.08)"}
            />
          </svg>
        ))}
      </div>
      <div className="star-label" style={{ color: info.color }}>{info.label}</div>
    </div>
  );
}

export default function ResultScreen({ result, scanId, onScanAgain, onHome }) {
  const [viewMode, setViewMode] = useState("details"); // "details", "inspect_qr", "receipt_qr", "cart_view"
  const [currentIndex, setCurrentIndex] = useState(0);
  const [cart, setCart] = useState(() => window.__siglaani_cart__ || []);
  const [checkoutData, setCheckoutData] = useState(null);
  const [checkingOut, setCheckingOut] = useState(false);

  // Weights state for weight-based calculation
  const [weights, setWeights] = useState({});
  const [vendorRates, setVendorRates] = useState({});

  useEffect(() => {
    fetch("http://localhost:5001/api/inventory")
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          const map = {};
          data.forEach((item) => {
            map[item.fruit_type.toLowerCase()] = item.price_per_kg || item.unit_price || 100;
          });
          setVendorRates(map);
        }
      })
      .catch(() => {});
  }, []);

  let resultsList = [];
  if (Array.isArray(result)) {
    resultsList = result.length > 0 ? result : [];
  } else if (result?.results && Array.isArray(result.results)) {
    resultsList = result.results;
  } else if (result && typeof result === "object") {
    resultsList = [result];
  }

  const res = resultsList[currentIndex] || resultsList[0] || {};
  
  const fruitName = res.fruit || res.fruit_type || "";
  const scientificName = res.scientific || "";
  const isRotten = res.condition === "rotten" || (res.conditionLabel && res.conditionLabel.toLowerCase().includes("bulok"));
  const statusLabel = res.conditionLabel || res.status || (isRotten ? "Bulok (Rotten)" : "Hinog (Ripe)");
  const confidenceVal = res.confidence != null ? Math.round(res.confidence) : 0;
  const ratingVal = res.rating ?? (isRotten ? 1 : 4);
  const recoText = res.recommendation || "";

  // Dynamic price per kilo display
  const pricePerKg = vendorRates[fruitName.toLowerCase()] || res.price_per_kg || DEFAULT_RATES[fruitName.toLowerCase()] || 100;

  let imageSource = null;
  if (res.image_url) {
    imageSource = res.image_url.startsWith("http") ? res.image_url : `http://127.0.0.1:5001${res.image_url}`;
  } else if (res.thumbnail) {
    imageSource = `data:image/jpeg;base64,${res.thumbnail}`;
  } else if (res.image) {
    imageSource = res.image.startsWith("data:") ? res.image : `data:image/jpeg;base64,${res.image}`;
  } else if (window.__siglaani_captured_image__) {
    imageSource = window.__siglaani_captured_image__;
  }

  const currentScanId = res.id || res.scan_id || `item_${currentIndex}`;
  const isCurrentInCart = cart.some(item => (item.id || item.scan_id) === currentScanId);

  const handleAddToCart = () => {
    if (!isCurrentInCart) {
      const itemToStaging = {
        ...res,
        id: currentScanId,
        scan_id: currentScanId,
        resolvedImage: imageSource,
        price_per_kg: pricePerKg
      };
      const updatedCart = [...cart, itemToStaging];
      setCart(updatedCart);
      window.__siglaani_cart__ = updatedCart;
    }
  };

  const handleRemoveFromCart = (idToRemove) => {
    const updatedCart = cart.filter(item => (item.id || item.scan_id) !== idToRemove);
    setCart(updatedCart);
    window.__siglaani_cart__ = updatedCart;
  };

  // Group same fruits in cart together for automatic quantity counting
  const groupedCart = useMemo(() => {
    const groups = {};
    cart.forEach((item) => {
      const name = item.fruit || item.fruit_type || "Fruit";
      const key = name.toLowerCase();
      if (!groups[key]) {
        groups[key] = {
          fruit_type: name,
          items: [],
          image_url: item.resolvedImage || (item.thumbnail ? `data:image/jpeg;base64,${item.thumbnail}` : null) || item.image_url || null
        };
      }
      groups[key].items.push(item);
    });
    return Object.values(groups);
  }, [cart]);

  const handleWeightChange = (key, val) => {
    if (/^\d*\.?\d*$/.test(val)) {
      setWeights((prev) => ({ ...prev, [key]: val }));
    }
  };

  const calculatedGroups = useMemo(() => {
    return groupedCart.map((group) => {
      const key = group.fruit_type.toLowerCase();
      const rate = vendorRates[key] || DEFAULT_RATES[key] || 100;
      const quantity = group.items.length;
      const weightVal = parseFloat(weights[key]);
      const hasWeight = !isNaN(weightVal) && weightVal > 0;
      const effectiveWeight = hasWeight ? weightVal : quantity * 0.25;
      const totalAmount = hasWeight ? Math.round(weightVal * rate) : Math.round(quantity * (rate * 0.25));

      return {
        ...group,
        key,
        rate,
        quantity,
        totalAmount,
        effectiveWeight
      };
    });
  }, [groupedCart, vendorRates, weights]);

  const grandTotal = useMemo(() => {
    return calculatedGroups.reduce((sum, g) => sum + g.totalAmount, 0);
  }, [calculatedGroups]);

  const handleCheckout = async () => {
    const itemsToCheckout = cart.length > 0 ? cart : resultsList;
    const scanIds = itemsToCheckout.map(item => item.id || item.scan_id).filter(id => typeof id === "number");
    const fruitBreakdown = calculatedGroups.map(g => ({
      fruit_type: g.fruit_type,
      quantity: g.quantity,
      weight_kg: g.effectiveWeight,
      total_price: g.totalAmount
    }));
    
    setCheckingOut(true);
    try {
      if (scanIds.length > 0) {
        const checkoutRes = await apiCheckout(scanIds, grandTotal, fruitBreakdown);
        if (checkoutRes && checkoutRes.success) {
          setCheckoutData(checkoutRes);
          setCart([]);
          window.__siglaani_cart__ = [];
          setViewMode("receipt_qr");
          return;
        }
      }
      // Fallback local receipt
      const ts = new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 14);
      setCheckoutData({
        success: true,
        transaction_id: `TXN_${ts}`,
        qr_payload: `siglaani://receipt/TXN_${ts}`,
        total_items: itemsToCheckout.length
      });
      setCart([]);
      window.__siglaani_cart__ = [];
      setViewMode("receipt_qr");
    } catch (err) {
      console.error("Checkout failed:", err);
    } finally {
      setCheckingOut(false);
    }
  };

  const inspectScanId = res.id || res.scan_id || scanId || 1;
  const inspectQrTarget = `siglaani://inspection/${inspectScanId}`;
  const inspectQrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(inspectQrTarget)}`;
  
  const receiptQrPayload = checkoutData?.qr_payload || `siglaani://receipt/${inspectQrTarget}`;
  const receiptQrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(receiptQrPayload)}`;

  const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="screen result-screen">
      <div className="result-header">
        <div className="header-logo">
          <LeafSVG />
          <div className="header-logo-text">SIGLA ANI</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          {cart.length > 0 && (
            <button 
              onClick={() => setViewMode("cart_view")}
              style={{
                background: "#7ee84a",
                color: "#0b1f0d",
                border: "none",
                borderRadius: "20px",
                padding: "4px 14px",
                fontWeight: "800",
                fontSize: "0.85rem",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                cursor: "pointer"
              }}
            >
              <FaShoppingBag /> Cart ({cart.length})
            </button>
          )}
          <div className={`result-badge badge-${isRotten ? 'rotten' : 'ripe'}`}>
            {statusLabel}
          </div>
        </div>
      </div>

      <div className="result-body" style={{ flexDirection: "column", overflowY: "auto", padding: "16px" }}>
        
        {/* VIEW: CART MODAL (NEW DESIGN) */}
        {viewMode === "cart_view" && (
          <div className="result-hero" style={{ padding: "20px", maxWidth: "560px", margin: "auto", width: "100%", background: "#f7f4ec", borderRadius: "20px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: "800", fontSize: "1.2rem", color: "#0b1f0d" }}>
                <FaShoppingBag color="#1a6630" /> Basket Items ({cart.length})
              </div>
              <button 
                onClick={() => setViewMode("details")}
                style={{ background: "none", border: "none", fontSize: "1.2rem", color: "#666", cursor: "pointer" }}
              >
                <FaTimes />
              </button>
            </div>

            {cart.length === 0 ? (
              <p style={{ textAlign: "center", color: "#666", padding: "20px 0" }}>Empty cart.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "12px", maxHeight: "380px", overflowY: "auto", marginBottom: "16px", paddingRight: "4px" }}>
                {calculatedGroups.map((group) => {
                  const itemImg = group.image_url || (group.items[0]?.thumbnail ? `data:image/jpeg;base64;${group.items[0].thumbnail}` : null);
                  return (
                    <div 
                      key={group.key}
                      style={{
                        background: "#ffffff",
                        padding: "16px",
                        borderRadius: "16px",
                        border: "1px solid #e5e7eb"
                      }}
                    >
                      {/* Top Row: Image, Name, Price, and Trash Button */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                          {itemImg && (
                            <img 
                              src={itemImg} 
                              alt={group.fruit_type} 
                              style={{ width: "48px", height: "48px", objectFit: "cover", borderRadius: "10px", background: "#051307" }} 
                            />
                          )}
                          <div>
                            <div style={{ fontWeight: "800", color: "#0b1f0d", fontSize: "1.05rem" }}>{group.fruit_type}</div>
                            <div style={{ fontSize: "0.82rem", color: "#16a34a", fontWeight: "700" }}>
                              ₱{group.rate} / kg
                            </div>
                          </div>
                        </div>

                        <button 
                          onClick={() => {
                            const ids = group.items.map(i => i.id || i.scan_id);
                            ids.forEach(id => handleRemoveFromCart(id));
                          }}
                          style={{ background: "#fee2e2", border: "none", color: "#ef4444", borderRadius: "8px", width: "32px", height: "32px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
                        >
                          <FaTrash size={12} />
                        </button>
                      </div>

                      {/* 3 Metric Inputs: KG (weight) | Quantity | Total Amount */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px" }}>
                        <div>
                          <label style={{ fontSize: "0.75rem", fontWeight: "700", color: "#64748b", display: "block", marginBottom: "4px" }}>
                            KG (weight)
                          </label>
                          <div style={{ display: "flex", alignItems: "center", background: "#fff", border: "1px solid #cbd5e1", borderRadius: "8px", padding: "4px 8px" }}>
                            <input
                              type="text"
                              inputMode="decimal"
                              placeholder="e.g. 1.25"
                              value={weights[group.key] || ""}
                              onChange={(e) => handleWeightChange(group.key, e.target.value)}
                              style={{ width: "100%", border: "none", outline: "none", fontSize: "0.9rem", fontWeight: "700", color: "#0f172a", background: "transparent" }}
                            />
                            <span style={{ fontSize: "0.75rem", color: "#94a3b8", fontWeight: "700", marginLeft: "4px" }}>kg</span>
                          </div>
                        </div>

                        <div>
                          <label style={{ fontSize: "0.75rem", fontWeight: "700", color: "#64748b", display: "block", marginBottom: "4px" }}>
                            Quantity
                          </label>
                          <div style={{ display: "flex", alignItems: "center", background: "#f8fafc", border: "1px solid #cbd5e1", borderRadius: "8px", padding: "4px 8px" }}>
                            <input
                              type="text"
                              readOnly
                              value={group.quantity}
                              style={{ width: "100%", border: "none", outline: "none", fontSize: "0.9rem", fontWeight: "700", color: "#334155", background: "transparent" }}
                            />
                            <span style={{ fontSize: "0.75rem", color: "#94a3b8", fontWeight: "700", marginLeft: "4px" }}>pcs</span>
                          </div>
                        </div>

                        <div>
                          <label style={{ fontSize: "0.75rem", fontWeight: "700", color: "#64748b", display: "block", marginBottom: "4px" }}>
                            Total Amount
                          </label>
                          <div style={{ display: "flex", alignItems: "center", background: "#f8fafc", border: "1px solid #cbd5e1", borderRadius: "8px", padding: "4px 8px" }}>
                            <input
                              type="text"
                              readOnly
                              value={group.totalAmount}
                              style={{ width: "100%", border: "none", outline: "none", fontSize: "0.9rem", fontWeight: "800", color: "#1a6630", background: "transparent" }}
                            />
                            <span style={{ fontSize: "0.75rem", color: "#94a3b8", fontWeight: "700", marginLeft: "4px" }}>₱</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: "10px" }}>
              <button 
                onClick={() => setViewMode("details")}
                style={{
                  background: "#fff",
                  border: "1px solid #cbd5e1",
                  borderRadius: "12px",
                  padding: "12px",
                  fontWeight: "700",
                  fontSize: "0.9rem",
                  color: "#334155",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "6px"
                }}
              >
                ← Back to Slides
              </button>
              <button 
                onClick={handleCheckout}
                disabled={checkingOut || cart.length === 0}
                style={{
                  background: "#1a6630",
                  border: "none",
                  borderRadius: "12px",
                  padding: "12px",
                  color: "#fff",
                  fontWeight: "800",
                  fontSize: "0.9rem",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "6px"
                }}
              >
                <FaCheck /> {checkingOut ? "Checking out..." : `Checkout (${cart.length})`}
              </button>
            </div>
          </div>
        )}

        {/* VIEW: INSPECTION QR SCREEN */}
        {viewMode === "inspect_qr" && (
          <div className="result-hero" style={{ textAlign: "center", padding: "28px 24px", maxWidth: "480px", margin: "auto", width: "100%" }}>
            <h2 style={{ fontSize: "1.5rem", fontWeight: "800", color: "#0b1f0d", marginBottom: "0.35rem" }}>
              Scan QR for Receipt & History
            </h2>
            <p style={{ color: "#666", fontSize: "0.9rem", marginBottom: "1.5rem" }}>
              Mayroong {resultsList.length} na-scan na prutas sa batch na ito.
            </p>
            
            <div style={{ background: "#fff", padding: "14px", display: "inline-block", borderRadius: "18px", boxShadow: "0 6px 20px rgba(0,0,0,0.06)", marginBottom: "1.75rem" }}>
              <img src={inspectQrUrl} alt="Inspection QR" style={{ width: "220px", height: "220px", display: "block" }} />
            </div>

            <button 
              className="scan-again-btn" 
              onClick={() => setViewMode("details")} 
              style={{ width: "100%", background: "#0b1f0d", color: "#7ee84a", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", borderRadius: "24px", padding: "12px 0" }}
            >
              <FaList /> Inspect Slides ({resultsList.length} Fruits)
            </button>
          </div>
        )}

        {/* VIEW: PURCHASED DIGITAL RECEIPT QR SCREEN */}
        {viewMode === "receipt_qr" && (
          <div className="result-hero" style={{ textAlign: "center", padding: "28px 24px", maxWidth: "480px", margin: "auto", width: "100%" }}>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: "10px" }}>
              <div style={{ background: "#7ee84a", borderRadius: "50%", width: "40px", height: "40px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <FaCheck size={22} color="#0b1f0d" />
              </div>
            </div>
            <h2 style={{ fontSize: "1.5rem", fontWeight: "800", color: "#0b1f0d", marginBottom: "0.25rem" }}>
              Digital Receipt Generated
            </h2>
            <p style={{ color: "#666", fontSize: "0.9rem", marginBottom: "1.5rem" }}>
              Batch Items: {checkoutData?.total_items || resultsList.length}
            </p>
            
            <div style={{ background: "#fff", padding: "14px", display: "inline-block", borderRadius: "18px", boxShadow: "0 6px 20px rgba(0,0,0,0.06)", marginBottom: "1.25rem" }}>
              <img src={receiptQrUrl} alt="Receipt QR" style={{ width: "220px", height: "220px", display: "block" }} />
            </div>

            <div style={{ fontSize: "0.85rem", color: "#666", fontFamily: "monospace", marginBottom: "1.5rem" }}>
              {receiptQrPayload}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              <button className="history-btn" onClick={onScanAgain} style={{ justifyContent: "center", display: "flex", gap: "6px" }}>
                <FaUndo /> Scan More
              </button>
              <button className="history-btn" onClick={onHome} style={{ justifyContent: "center", display: "flex", gap: "6px" }}>
                <FaHome /> Home
              </button>
            </div>
          </div>
        )}

        {/* VIEW: MAIN DETAILS SCREEN */}
        {viewMode === "details" && (
          <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "16px" }}>
            {resultsList.length > 1 && (
              <div className="result-hero" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px", marginBottom: "0" }}>
                <button 
                  onClick={() => setCurrentIndex(prev => Math.max(0, prev - 1))}
                  disabled={currentIndex === 0}
                  style={{ background: "none", border: "none", display: "flex", alignItems: "center", gap: "4px", fontSize: "14px", fontWeight: "bold", cursor: currentIndex === 0 ? "not-allowed" : "pointer", color: currentIndex === 0 ? "#bbb" : "#0b1f0d" }}
                >
                  <FaChevronLeft /> Prev
                </button>

                <span style={{ fontWeight: "800", color: "#1a6630", fontSize: "0.95rem" }}>
                  Fruit {currentIndex + 1} of {resultsList.length}
                </span>

                <button 
                  onClick={() => setCurrentIndex(prev => Math.min(resultsList.length - 1, prev + 1))}
                  disabled={currentIndex === resultsList.length - 1}
                  style={{ background: "none", border: "none", display: "flex", alignItems: "center", gap: "4px", fontSize: "14px", fontWeight: "bold", cursor: currentIndex === resultsList.length - 1 ? "not-allowed" : "pointer", color: currentIndex === resultsList.length - 1 ? "#bbb" : "#0b1f0d" }}
                >
                  Next <FaChevronRight />
                </button>
              </div>
            )}

            <div className="result-hero">
              {imageSource && (
                <div style={{ width: "100%", height: "220px", borderRadius: "12px", overflow: "hidden", marginBottom: "16px", background: "#051307" }}>
                  <img 
                    src={imageSource} 
                    alt={fruitName} 
                    style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} 
                  />
                </div>
              )}

              <div className="res-fruit-profile">
                <div className="res-title-row">
                  <div>
                    <h1 className="res-name">{fruitName}</h1>
                    <span className="res-sci">{scientificName}</span>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: "1.2rem", fontWeight: "800", color: "#1a6630" }}>
                      ₱{pricePerKg}
                    </div>
                    <span style={{ fontSize: "0.75rem", color: "#666" }}>per kilo</span>
                  </div>
                </div>
                <StarRating rating={ratingVal} />
              </div>

              <div className="res-rec-box">
                <div className="res-rec-label">Storage Recommendation:</div>
                <div className="res-rec-text">"{recoText}"</div>
              </div>
            </div>

            <div className="res-meta-grid">
              <div className="res-meta-cell">
                <div className="res-meta-label">Confidence</div>
                <div className="res-meta-val">{confidenceVal}%</div>
              </div>
              <div className="res-meta-cell">
                <div className="res-meta-label">Status</div>
                <div className="res-meta-val" style={{ color: isRotten ? '#ef5350' : '#4ade80' }}>
                  {statusLabel}
                </div>
              </div>
              <div className="res-meta-cell">
                <div className="res-meta-label">Oras ng Scan</div>
                <div className="res-meta-val">{now}</div>
              </div>
            </div>

            <div className="result-footer" style={{ marginTop: "8px", display: "flex", flexDirection: "column", gap: "10px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                <button 
                  onClick={handleAddToCart}
                  disabled={isCurrentInCart || isRotten}
                  className="history-btn"
                  style={{ 
                    background: isCurrentInCart ? "#e0f2fe" : "#f1f8e9", 
                    color: isCurrentInCart ? "#0284c7" : "#1a6630", 
                    fontWeight: "700", 
                    display: "flex", 
                    alignItems: "center", 
                    justifyContent: "center", 
                    gap: "6px" 
                  }}
                >
                  <FaCartPlus /> {isCurrentInCart ? "Added to Cart" : "Add to Cart"}
                </button>

                <button 
                  onClick={() => cart.length > 0 ? setViewMode("cart_view") : handleCheckout()}
                  disabled={checkingOut}
                  className="scan-again-btn"
                  style={{ background: "#1a6630", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}
                >
                  <FaShoppingBag /> {checkingOut ? "Checking out..." : `Checkout (${cart.length})`}
                </button>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                <button className="scan-again-btn" onClick={onScanAgain}>+ I-scan Muli</button>
                <button className="history-btn" onClick={() => setViewMode("inspect_qr")} style={{ display: "flex", gap: "6px", alignItems: "center", justifyContent: "center" }}>
                  <FaQrcode /> View QR
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}