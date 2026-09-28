import { useState, useEffect } from 'react';
import { FaWifi, FaExclamationTriangle } from 'react-icons/fa';

export default function SyncStatusBadge() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '6px 12px',
        borderRadius: '9999px',
        fontSize: '12px',
        fontWeight: '600',
        backgroundColor: isOnline ? 'rgba(34, 197, 94, 0.15)' : 'rgba(249, 115, 22, 0.15)',
        color: isOnline ? '#15803d' : '#c2410c',
        border: `1px solid ${isOnline ? '#86efac' : '#fdba74'}`,
        transition: 'all 0.3s ease',
      }}
    >
      {isOnline ? (
        <>
          <FaWifi size={12} />
          <span>Online (Synced)</span>
        </>
      ) : (
        <>
          <FaExclamationTriangle size={12} />
          <span>Offline (Local)</span>
        </>
      )}
    </div>
  );
}