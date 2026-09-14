import { useState, useEffect } from 'react';
import LeafSVG from './shared/LeafSVG';
import { FaArrowLeft, FaSyncAlt } from 'react-icons/fa';
import { apiHistory } from '../api';

export default function DashboardScreen({ onBack }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchStats = async () => {
    setLoading(true);
    try {
      const data = await apiHistory(200);
      if (Array.isArray(data)) {
        setHistory(data);
      } else if (data && Array.isArray(data.history)) {
        setHistory(data.history);
      } else {
        setHistory([]);
      }
    } catch (err) {
      console.warn("Could not load dashboard data:", err);
      setHistory([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  const totalScans = history.length;
  
  const fruitCounts = {};
  let ripeCount = 0;
  let rottenCount = 0;

  history.forEach(item => {
    const name = item.fruit || item.fruit_type || 'Unknown';
    fruitCounts[name] = (fruitCounts[name] || 0) + 1;

    const condition = (item.condition || item.condition_label || item.status || '').toLowerCase();
    if (condition.includes('hinog') || condition.includes('ripe')) {
      ripeCount++;
    } else if (condition.includes('bulok') || condition.includes('rotten')) {
      rottenCount++;
    }
  });

  let topFruit = 'N/A';
  let maxCount = 0;
  Object.entries(fruitCounts).forEach(([fruit, count]) => {
    if (count > maxCount) {
      maxCount = count;
      topFruit = fruit;
    }
  });

  const freshnessRate = totalScans > 0 ? Math.round((ripeCount / totalScans) * 100) : 0;

  return (
    <div className="screen dashboard-screen">
      {/* Header Bar */}
      <div className="result-header" style={{ padding: '16px 20px' }}>
        <button 
          onClick={onBack} 
          style={{ 
            background: 'none', 
            border: 'none', 
            color: '#7ee84a', 
            fontSize: '1rem', 
            fontWeight: '800', 
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <FaArrowLeft /> Bumalik
        </button>

        <button 
          onClick={fetchStats}
          style={{
            background: '#1a6630',
            border: 'none',
            color: '#fff',
            padding: '6px 16px',
            borderRadius: '20px',
            fontWeight: '700',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '0.85rem'
          }}
        >
          <FaSyncAlt /> I-refresh
        </button>
      </div>

      <div className="result-body" style={{ flexDirection: 'column', overflowY: 'auto', padding: '24px' }}>
        {loading ? (
          <p style={{ textAlign: 'center', color: '#666', marginTop: '30px' }}>Kinukuha ang datos...</p>
        ) : (
          <>
            {/* Top Metric Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '20px' }}>
              
              <div style={{ background: '#fff', padding: '20px', borderRadius: '14px', borderLeft: '5px solid #22c55e', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
                <div style={{ fontSize: '0.78rem', fontWeight: '800', color: '#666', textTransform: 'uppercase' }}>
                  KABUUAN NG NA-SCAN
                </div>
                <div style={{ fontSize: '2.4rem', fontWeight: '900', color: '#0b1f0d', marginTop: '6px' }}>
                  {totalScans}
                </div>
              </div>

              <div style={{ background: '#fff', padding: '20px', borderRadius: '14px', borderLeft: '5px solid #eab308', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
                <div style={{ fontSize: '0.78rem', fontWeight: '800', color: '#666', textTransform: 'uppercase' }}>
                  NANGUNGUNANG PRUTAS
                </div>
                <div style={{ fontSize: '2rem', fontWeight: '900', color: '#0b1f0d', marginTop: '6px' }}>
                  {topFruit} {maxCount > 0 ? `(${maxCount})` : ''}
                </div>
              </div>

              <div style={{ background: '#fff', padding: '20px', borderRadius: '14px', borderLeft: '5px solid #3b82f6', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
                <div style={{ fontSize: '0.78rem', fontWeight: '800', color: '#666', textTransform: 'uppercase' }}>
                  FRESHNESS RATE (HINOG)
                </div>
                <div style={{ fontSize: '2.4rem', fontWeight: '900', color: '#0b1f0d', marginTop: '6px' }}>
                  {freshnessRate}%
                </div>
              </div>

            </div>

            {/* Distribution Card */}
            <div style={{ background: '#fff', padding: '22px', borderRadius: '14px', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: '800', color: '#0b1f0d', marginBottom: '16px' }}>
                Distribusyon ng Bawat Prutas
              </h3>

              {Object.keys(fruitCounts).length === 0 ? (
                <p style={{ color: '#888', fontSize: '0.9rem' }}>Wala pang mga na-scan na prutas.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  {Object.entries(fruitCounts).map(([fruit, count]) => {
                    const percentage = Math.round((count / totalScans) * 100);
                    return (
                      <div key={fruit} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', fontWeight: '700', color: '#111' }}>
                          <span>{fruit}</span>
                          <span>{count} scans ({percentage}%)</span>
                        </div>
                        <div style={{ width: '100%', height: '8px', background: '#e5e7eb', borderRadius: '4px', overflow: 'hidden' }}>
                          <div style={{ width: `${percentage}%`, height: '100%', background: '#1a6630', borderRadius: '4px' }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}