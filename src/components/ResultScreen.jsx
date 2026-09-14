import { useState, useEffect, useMemo } from 'react';
import LeafSVG from './shared/LeafSVG';
import { 
  FaUndo, FaHome, FaChevronLeft, FaChevronRight, 
  FaQrcode, FaList, FaCartPlus, FaCheck, FaShoppingBag, 
  FaTrash, FaTimes 
} from 'react-icons/fa';
import { apiCheckout } from '../api';
import '../styles/ResultScreen.css';

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

  // Dynamic pricing & weight input states
  const [weights, setWeights] = useState({});
  const [vendorRates, setVendorRates] = useState({});

  useEffect(() => {
    fetch("http://127.0.0.1:5001/api/inventory")
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

  // Group same fruits in cart together for automatic quantity calculation
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
      const rawWeight = weights[key];
      const weightVal = parseFloat(rawWeight);
      const hasValidWeight = !isNaN(weightVal) && weightVal > 0;
      
      const totalAmount = hasValidWeight ? Math.round(weightVal * rate) : null;

      return {
        ...group,
        key,
        rate,
        quantity,
        hasValidWeight,
        totalAmount,
        effectiveWeight: hasValidWeight ? weightVal : 0
      };
    });
  }, [groupedCart, vendorRates, weights]);

  // All groups must have an entered weight > 0 before checkout is enabled
  const isWeightValid = useMemo(() => {
    if (calculatedGroups.length === 0) return false;
    return calculatedGroups.every(g => g.hasValidWeight);
  }, [calculatedGroups]);

  const grandTotal = useMemo(() => {
    return calculatedGroups.reduce((sum, g) => sum + (g.totalAmount || 0), 0);
  }, [calculatedGroups]);

  const handleCheckout = async () => {
    if (!isWeightValid || checkingOut) return;

    const itemsToCheckout = cart.length > 0 ? cart : resultsList;
    const scanIds = itemsToCheckout
      .map(item => item.id ?? item.scan_id ?? scanId)
      .map(id => Number(id))
      .filter(id => !isNaN(id) && id > 0);

    const fruitBreakdown = calculatedGroups.map(g => ({
      fruit_type: g.fruit_type,
      quantity: g.quantity,
      weight_kg: g.effectiveWeight,
      total_price: g.totalAmount
    }));

    setCheckingOut(true);
    try {
      const checkoutRes = await apiCheckout({
        scan_ids: scanIds,
        total_amount: grandTotal,
        fruit_breakdown: fruitBreakdown
      });

      if (checkoutRes && checkoutRes.success) {
        setCheckoutData(checkoutRes);
        setCart([]);
        window.__siglaani_cart__ = [];
        setViewMode("receipt_qr");
        return;
      }
    } catch (err) {
      console.error("Checkout failed:", err);
      const ts = new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 14);
      setCheckoutData({
        success: true,
        transaction_id: `TXN_${ts}`,
        qr_payload: `siglaani://receipt/TXN_${ts}`,
        total_items: itemsToCheckout.length,
        total_amount: grandTotal
      });
      setCart([]);
      window.__siglaani_cart__ = [];
      setViewMode("receipt_qr");
    } finally {
      setCheckingOut(false);
    }
  };

  const inspectScanId = res.id || res.scan_id || scanId || 1;
  const inspectQrTarget = `siglaani://inspection/${inspectScanId}`;
  const inspectQrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(inspectQrTarget)}`;
  
  const receiptQrPayload = checkoutData?.qr_payload || (checkoutData?.transaction_id ? `siglaani://receipt/${checkoutData.transaction_id}` : `siglaani://receipt/TXN_DEMO`);
  const receiptQrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(receiptQrPayload)}`;

  const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="screen result-screen">
      <div className="result-header">
        <div className="header-logo">
          <LeafSVG />
          <div className="header-logo-text">SIGLA ANI</div>
        </div>
        <div className="result-header-right">
          {cart.length > 0 && (
            <button 
              className="cart-badge-btn"
              onClick={() => setViewMode("cart_view")}
            >
              <FaShoppingBag /> Cart ({cart.length})
            </button>
          )}
          <div className={`result-badge badge-${isRotten ? 'rotten' : 'ripe'}`}>
            {statusLabel}
          </div>
        </div>
      </div>

      <div className="result-body">
        
        {/* VIEW: CART MODAL */}
        {viewMode === "cart_view" && (
          <div className="result-hero basket-modal-hero">
            <div className="basket-modal-header">
              <div className="basket-modal-title">
                <FaShoppingBag className="basket-bag-icon" /> Basket Items ({cart.length})
              </div>
              <button 
                onClick={() => setViewMode("details")}
                className="basket-close-btn"
              >
                <FaTimes />
              </button>
            </div>

            {cart.length === 0 ? (
              <p className="basket-empty-text">Empty cart.</p>
            ) : (
              <div className="basket-list-container">
                {calculatedGroups.map((group) => {
                  const itemImg = group.image_url || (group.items[0]?.thumbnail ? `data:image/jpeg;base64,${group.items[0].thumbnail}` : null);
                  return (
                    <div key={group.key} className="basket-item-card">
                      <div className="basket-item-top">
                        <div className="basket-item-info">
                          {itemImg && (
                            <img 
                              src={itemImg} 
                              alt={group.fruit_type} 
                              className="basket-item-thumb" 
                            />
                          )}
                          <div>
                            <div className="basket-item-title">{group.fruit_type}</div>
                            <div className="basket-item-rate">
                              ₱{group.rate} / kg
                            </div>
                          </div>
                        </div>

                        <button 
                          onClick={() => {
                            const ids = group.items.map(i => i.id || i.scan_id);
                            ids.forEach(id => handleRemoveFromCart(id));
                          }}
                          className="basket-item-delete-btn"
                        >
                          <FaTrash size={12} />
                        </button>
                      </div>

                      {/* 3 Inputs Grid: KG (weight) | Quantity | Total Amount */}
                      <div className="basket-inputs-grid">
                        <div>
                          <label className="basket-field-label">
                            KG (weight)
                          </label>
                          <div className="basket-input-wrap">
                            <input
                              type="text"
                              inputMode="decimal"
                              placeholder="e.g. 1.25"
                              value={weights[group.key] || ""}
                              onChange={(e) => handleWeightChange(group.key, e.target.value)}
                              className="basket-input"
                            />
                            <span className="basket-unit">kg</span>
                          </div>
                        </div>

                        <div>
                          <label className="basket-field-label">
                            Quantity
                          </label>
                          <div className="basket-input-wrap readonly">
                            <input
                              type="text"
                              readOnly
                              value={group.quantity}
                              className="basket-input"
                            />
                            <span className="basket-unit">pcs</span>
                          </div>
                        </div>

                        <div>
                          <label className="basket-field-label">
                            Total Amount
                          </label>
                          <div className="basket-input-wrap readonly">
                            <span className="basket-prefix">₱</span>
                            <input
                              type="text"
                              readOnly
                              placeholder="e.g. 200"
                              value={group.hasValidWeight ? group.totalAmount : ""}
                              className={`basket-input ${group.hasValidWeight ? 'total-val' : 'total-placeholder'}`}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="basket-actions-grid">
              <button 
                onClick={() => setViewMode("details")}
                className="basket-back-btn"
              >
                ← Back to Slides
              </button>
              <button 
                onClick={handleCheckout}
                disabled={!isWeightValid || checkingOut || cart.length === 0}
                className={`basket-checkout-btn ${(!isWeightValid || cart.length === 0) ? 'btn-disabled' : ''}`}
              >
                <FaCheck /> {checkingOut ? "Checking out..." : `Checkout (${cart.length})`}
              </button>
            </div>
          </div>
        )}

        {/* VIEW: INSPECTION QR SCREEN */}
        {viewMode === "inspect_qr" && (
          <div className="result-hero qr-container-card">
            <h2 className="qr-title">
              Fruit Inspection QR
            </h2>
            <p className="qr-sub">
              I-scan gamit ang mobile app para i-save ang inspection at freshness log ng {fruitName}.
            </p>
            
            <div className="qr-wrapper-box">
              <img src={inspectQrUrl} alt="Inspection QR" className="qr-img" />
            </div>

            <button 
              className="scan-again-btn btn-inspect-full" 
              onClick={() => setViewMode("details")} 
            >
              <FaList /> Inspect Slides ({resultsList.length} Fruits)
            </button>
          </div>
        )}

        {/* VIEW: DIGITAL RECEIPT QR SCREEN */}
        {viewMode === "receipt_qr" && (
          <div className="result-hero qr-container-card">
            <div className="receipt-icon-circle">
              <FaCheck size={22} color="#0b1f0d" />
            </div>
            <h2 className="qr-title">
              Digital Receipt Generated
            </h2>
            <p className="qr-sub">
              Batch Items: {checkoutData?.total_items || resultsList.length} | Halaga: ₱{checkoutData?.total_amount || grandTotal || 0}
            </p>
            
            <div className="qr-wrapper-box receipt-space">
              <img src={receiptQrUrl} alt="Receipt QR" className="qr-img" />
            </div>

            <div className="receipt-btns-grid">
              <button className="history-btn receipt-btn-centered" onClick={onScanAgain}>
                <FaUndo /> Scan More
              </button>
              <button className="history-btn receipt-btn-centered" onClick={onHome}>
                <FaHome /> Home
              </button>
            </div>
          </div>
        )}

        {/* VIEW: MAIN DETAILS SCREEN */}
        {viewMode === "details" && (
          <div className="details-view-container">
            {resultsList.length > 1 && (
              <div className="result-hero slider-pagination-bar">
                <button 
                  onClick={() => setCurrentIndex(prev => Math.max(0, prev - 1))}
                  disabled={currentIndex === 0}
                  className={`pagination-arrow-btn ${currentIndex === 0 ? 'disabled' : ''}`}
                >
                  <FaChevronLeft /> Prev
                </button>

                <span className="pagination-text">
                  Fruit {currentIndex + 1} of {resultsList.length}
                </span>

                <button 
                  onClick={() => setCurrentIndex(prev => Math.min(resultsList.length - 1, prev + 1))}
                  disabled={currentIndex === resultsList.length - 1}
                  className={`pagination-arrow-btn ${currentIndex === resultsList.length - 1 ? 'disabled' : ''}`}
                >
                  Next <FaChevronRight />
                </button>
              </div>
            )}

            <div className="result-hero">
              {imageSource && (
                <div className="res-hero-image-wrapper">
                  <img 
                    src={imageSource} 
                    alt={fruitName} 
                    className="res-hero-image" 
                  />
                </div>
              )}

              <div className="res-fruit-profile">
                <div className="res-title-row">
                  <div>
                    <h1 className="res-name">{fruitName}</h1>
                    <span className="res-sci">{scientificName}</span>
                  </div>
                  <div className="res-price-col">
                    <div className="res-price-val">
                      ₱{pricePerKg}
                    </div>
                    <span className="res-price-unit">per kilo</span>
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
                <div className={`res-meta-val ${isRotten ? 'status-rotten' : 'status-fresh'}`}>
                  {statusLabel}
                </div>
              </div>
              <div className="res-meta-cell">
                <div className="res-meta-label">Oras ng Scan</div>
                <div className="res-meta-val">{now}</div>
              </div>
            </div>

            {/* ACTION CONTROLS */}
            <div className="result-footer-custom">
              {/* Row 1: Add to Cart (Left) and View QR (Right) */}
              <div className="result-actions-row-top">
                <button 
                  onClick={handleAddToCart}
                  disabled={isCurrentInCart || isRotten}
                  className={`history-btn ${isCurrentInCart ? 'cart-btn-added' : 'cart-btn-unadded'}`}
                >
                  <FaCartPlus /> {isCurrentInCart ? "Added to Cart" : "Add to Cart"}
                </button>

                <button 
                  className="history-btn btn-view-qr-top" 
                  onClick={() => setViewMode("inspect_qr")}
                >
                  <FaQrcode /> View QR
                </button>
              </div>

              {/* Row 2: Centered full-width I-scan Muli button */}
              <div>
                <button 
                  className="scan-again-btn btn-scan-again-centered" 
                  onClick={onScanAgain}
                >
                  + I-scan Muli
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}