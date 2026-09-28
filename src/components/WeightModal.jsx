import React, { useState } from 'react';

export default function WeightModal({ 
  mode = "weight", // "weight" or "currency"
  title,
  subtitle,
  fruit, 
  pricePerKg, 
  onConfirm, 
  onCancel 
}) {
  const [val, setVal] = useState('');

  const handleKeyPress = (keyVal) => {
    if (keyVal === 'DEL') {
      setVal((prev) => prev.slice(0, -1));
    } else if (keyVal === 'C') {
      setVal('');
    } else if (keyVal === '.') {
      if (!val.includes('.')) {
        setVal((prev) => (prev === '' ? '0.' : prev + '.'));
      }
    } else {
      // Limit to 2 decimal places
      if (val.includes('.') && val.split('.')[1].length >= 2) return;
      setVal((prev) => prev + keyVal);
    }
  };

  const parsedVal = parseFloat(val) || 0;
  const isCurrency = mode === "currency";
  const unitPrice = pricePerKg || 100;
  const subtotal = (parsedVal * unitPrice).toFixed(2);

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      backgroundColor: 'rgba(15, 23, 42, 0.75)',
      backdropFilter: 'blur(4px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999
    }}>
      <div style={{
        background: '#ffffff',
        borderRadius: '20px',
        padding: '24px',
        width: '320px',
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.3)',
        textAlign: 'center'
      }}>
        <h3 style={{ margin: '0 0 4px 0', fontSize: '20px', color: '#0F172A', fontWeight: '800' }}>
          {title || (isCurrency ? "Ilagay ang Tawad / Bawas" : "Ilagay ang Timbang")}
        </h3>
        <p style={{ margin: '0 0 16px 0', fontSize: '13px', color: '#64748B' }}>
          {subtitle || (isCurrency ? "Kabuuang diskwento sa bayarin" : `${fruit || 'Prutas'} • ₱${unitPrice} / kg`)}
        </p>

        {/* Display Area */}
        <div style={{
          backgroundColor: '#F8FAFC',
          border: '2px solid #CBD5E1',
          borderRadius: '12px',
          padding: '12px',
          marginBottom: '14px'
        }}>
          <div style={{ fontSize: '32px', fontWeight: '800', color: '#0F172A' }}>
            {isCurrency && <span style={{ fontSize: '24px', color: '#16A34A', marginRight: '4px' }}>₱</span>}
            {val || '0.00'} 
            {!isCurrency && <span style={{ fontSize: '16px', color: '#64748B', marginLeft: '4px' }}>kg</span>}
          </div>
          {!isCurrency && (
            <div style={{ fontSize: '13px', fontWeight: '600', color: '#16A34A', marginTop: '2px' }}>
              Subtotal: ₱{subtotal}
            </div>
          )}
        </div>

        {/* 3x4 Touch Numpad Grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '10px',
          marginBottom: '16px'
        }}>
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'DEL'].map((keyVal) => (
            <button
              key={keyVal}
              type="button"
              onClick={() => handleKeyPress(keyVal)}
              style={{
                height: '52px',
                fontSize: '20px',
                fontWeight: '700',
                borderRadius: '10px',
                border: '1px solid #E2E8F0',
                backgroundColor: keyVal === 'DEL' ? '#FEE2E2' : '#FFFFFF',
                color: keyVal === 'DEL' ? '#DC2626' : '#1E293B',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              {keyVal}
            </button>
          ))}
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              flex: 1,
              padding: '12px',
              borderRadius: '10px',
              border: '1px solid #CBD5E1',
              backgroundColor: '#F1F5F9',
              color: '#475569',
              fontWeight: '700',
              cursor: 'pointer'
            }}
          >
            I-kansela
          </button>
          <button
            type="button"
            onClick={() => onConfirm(parsedVal)}
            style={{
              flex: 1.2,
              padding: '12px',
              borderRadius: '10px',
              border: 'none',
              backgroundColor: '#16A34A',
              color: '#FFFFFF',
              fontWeight: '700',
              cursor: 'pointer'
            }}
          >
            I-kumpirma
          </button>
        </div>
      </div>
    </div>
  );
}