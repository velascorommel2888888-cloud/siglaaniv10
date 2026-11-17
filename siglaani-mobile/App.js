import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Text,
  View,
  TouchableOpacity,
  FlatList,
  Alert,
  ActivityIndicator,
  StatusBar,
  TextInput,
  ScrollView,
  Modal,
  StyleSheet,
  Image
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Feather, Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BASE_URL } from './config';
import { vendorStyles, COLORS, styles as baseStyles } from './styles';
import { STATUS_COLORS } from './themeColors';
import LoginScreen from './LoginScreen';
import DateFilterBar from './DateFilterBar';

const STORAGE_RECEIPTS_KEY = '@siglaani_receipts';
const STORAGE_INSPECTIONS_KEY = '@siglaani_inspections';
const STORAGE_STOCK_LOGS_KEY = '@siglaani_stock_logs';
const STORAGE_AUTH_USER_KEY = '@siglaani_auth_user';

function getShelfLifeInfo(conditionLabel, purchasedAt) {
  const label = (conditionLabel || '').toLowerCase();
  const buyDate = purchasedAt ? new Date(purchasedAt).getTime() : Date.now();
  const now = Date.now();
  const elapsedDays = (now - buyDate) / (1000 * 60 * 60 * 24);

  let totalDays = 5;
  if (label.includes('sobrang hinog') || label.includes('overripe')) {
    totalDays = 2;
  } else if (label.includes('hindi pa hinog') || label.includes('unripe')) {
    totalDays = 4;
  } else if (label.includes('bulok') || label.includes('rotten')) {
    totalDays = 0;
  }

  const daysRemaining = Math.max(0, Math.ceil(totalDays - elapsedDays));
  const isExpiringSoon = daysRemaining <= 1 && totalDays > 0;

  return {
    totalDays,
    daysRemaining,
    isExpiringSoon,
    statusText: daysRemaining === 0 ? 'Kailangan nang gamitin/itapon' : `${daysRemaining} araw natitira`
  };
}

function checkFruitSpoilageOnLaunch(storedReceipts) {
  if (!Array.isArray(storedReceipts) || storedReceipts.length === 0) return;

  const expiringFruits = [];

  storedReceipts.forEach(receipt => {
    (receipt.items || []).forEach(fruit => {
      const isRotten = (fruit.status || '').toLowerCase().includes('bulok') || (fruit.status || '').toLowerCase().includes('rotten');
      if (isRotten) return;

      const shelfLife = getShelfLifeInfo(fruit.status, receipt.purchased_at);
      if (shelfLife.isExpiringSoon || shelfLife.daysRemaining === 0) {
        expiringFruits.push({
          name: fruit.fruit_type || fruit.fruit || 'Prutas',
          status: shelfLife.statusText
        });
      }
    });
  });

  if (expiringFruits.length > 0) {
    const listText = expiringFruits.map(f => `• ${f.name} (${f.status})`).join('\n');
    Alert.alert(
      '⚠️ Sigla Ani Spoilage Alert',
      `May mga prutas kang kailangang gamitin kaagad:\n\n${listText}`,
      [{ text: 'Titingnan Ko', style: 'default' }]
    );
  }
}

export default function App() {
  return (
    <SafeAreaProvider>
      <MainApp />
    </SafeAreaProvider>
  );
}

function MainApp() {
  const [currentUser, setCurrentUser] = useState(null);

  const [role, setRole] = useState('vendor');
  const [vendorNavTab, setVendorNavTab] = useState('inventory');
  const [consumerTab, setConsumerTab] = useState('receipts');
  const [consumerScreen, setConsumerScreen] = useState('basket');

  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [loading, setLoading] = useState(false);
  const [receipts, setReceipts] = useState([]);
  const [inspections, setInspections] = useState([]);
  const [expandedTxn, setExpandedTxn] = useState(null);

  // Inventory States & Archive Toggle
  const [inventoryTab, setInventoryTab] = useState('active'); // 'active' or 'archived'
  const [activeFilter, setActiveFilter] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [inventoryList, setInventoryList] = useState([]);
  const [loadingInv, setLoadingInv] = useState(false);

  // Edit Mode States
  const [selectedFruit, setSelectedFruit] = useState(null);
  const [editPrice, setEditPrice] = useState('');
  const [baseStock, setBaseStock] = useState(0);
  const [supplierName, setSupplierName] = useState('');
  const [stockAdjustmentMode, setStockAdjustmentMode] = useState('add');
  const [adjustmentQty, setAdjustmentQty] = useState('');
  const [saving, setSaving] = useState(false);
  const [stockLogsMap, setStockLogsMap] = useState({});
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);

  // Kiosk Sync States
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);
  const [kioskCodeInput, setKioskCodeInput] = useState('');
  const [syncingKiosk, setSyncingKiosk] = useState(false);

  // Analytics & Sales States with Date Filter
  const [serverHistory, setServerHistory] = useState([]);
  const [salesList, setSalesList] = useState([]);
  const [salesFilterPreset, setSalesFilterPreset] = useState('all');
  const [loadingSales, setLoadingSales] = useState(false);

  // Add Fruit Modal State
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newFruitName, setNewFruitName] = useState('');
  const [newStockKg, setNewStockKg] = useState('50');
  const [newPricePerKg, setNewPricePerKg] = useState('100');
  const [newSupplierName, setNewSupplierName] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const userJson = await AsyncStorage.getItem(STORAGE_AUTH_USER_KEY);
        if (userJson) {
          const parsed = JSON.parse(userJson);
          setCurrentUser(parsed);
          setRole(parsed.role || 'vendor');
        }

        const recJson = await AsyncStorage.getItem(STORAGE_RECEIPTS_KEY);
        const inspJson = await AsyncStorage.getItem(STORAGE_INSPECTIONS_KEY);
        const logsJson = await AsyncStorage.getItem(STORAGE_STOCK_LOGS_KEY);

        if (recJson) {
          const parsedRec = JSON.parse(recJson);
          setReceipts(parsedRec);
          checkFruitSpoilageOnLaunch(parsedRec);
        }
        if (inspJson) setInspections(JSON.parse(inspJson));
        if (logsJson) setStockLogsMap(JSON.parse(logsJson));
      } catch (e) {
        console.warn('Failed to load local data:', e);
      }
    })();
  }, []);

  const handleLogout = async () => {
    await AsyncStorage.removeItem(STORAGE_AUTH_USER_KEY);
    setCurrentUser(null);
    setSelectedFruit(null);
    setInventoryList([]);
    setSalesList([]);
    setServerHistory([]);
  };

  // Vendor Scoped Inventory: Zero if kiosk is unpaired
  const fetchVendorInventory = useCallback(async () => {
    if (!currentUser) return;

    if (!currentUser.synced_kiosk_code) {
      setInventoryList([]);
      setLoadingInv(false);
      return;
    }

    setLoadingInv(true);
    try {
      const isArchived = inventoryTab === 'archived' ? '1' : '0';
      const res = await fetch(
        `${BASE_URL}/api/inventory?vendor_id=${currentUser.id}&kiosk_code=${encodeURIComponent(currentUser.synced_kiosk_code)}&archived=${isArchived}`
      );
      if (res.ok) {
        const data = await res.json();
        setInventoryList(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.warn('Could not fetch inventory:', err);
    } finally {
      setLoadingInv(false);
    }
  }, [currentUser, inventoryTab]);

  // Dashboard & Sales: Zero if kiosk is unpaired
  const fetchAnalyticsAndSales = useCallback(async (preset = salesFilterPreset) => {
    if (!currentUser) return;

    if (!currentUser.synced_kiosk_code) {
      setServerHistory([]);
      setSalesList([]);
      setLoadingSales(false);
      return;
    }

    setLoadingSales(true);
    try {
      const [histRes, txnRes] = await Promise.all([
        fetch(`${BASE_URL}/api/history?kiosk_code=${encodeURIComponent(currentUser.synced_kiosk_code)}&limit=200`).catch(() => null),
        fetch(`${BASE_URL}/api/transactions?vendor_id=${currentUser.id}&kiosk_code=${encodeURIComponent(currentUser.synced_kiosk_code)}&filter_preset=${preset}`).catch(() => null)
      ]);

      if (histRes && histRes.ok) {
        const hData = await histRes.json();
        setServerHistory(Array.isArray(hData) ? hData : []);
      }

      if (txnRes && txnRes.ok) {
        const tData = await txnRes.json();
        setSalesList(Array.isArray(tData) ? tData : []);
      }
    } catch (err) {
      console.warn('Could not fetch sales:', err);
    } finally {
      setLoadingSales(false);
    }
  }, [currentUser, salesFilterPreset]);

  useEffect(() => {
    if (currentUser && role === 'vendor') {
      fetchVendorInventory();
    }
  }, [currentUser, role, inventoryTab, currentUser?.synced_kiosk_code, fetchVendorInventory]);

  useEffect(() => {
    if (currentUser && role === 'vendor') {
      fetchAnalyticsAndSales(salesFilterPreset);
    }
  }, [currentUser, role, salesFilterPreset, currentUser?.synced_kiosk_code, fetchAnalyticsAndSales]);

  const filteredInventory = useMemo(() => {
    return inventoryList.filter((item) => {
      const nameMatch = (item.fruit_type || '').toLowerCase().includes(searchQuery.toLowerCase());
      const stock = Number(item.stock_count) || 0;
      if (!nameMatch) return false;
      if (activeFilter === 'Available') return stock > 0;
      if (activeFilter === 'Out of Stock') return stock <= 0;
      return true;
    });
  }, [inventoryList, searchQuery, activeFilter]);

  const fruitSalesStats = useMemo(() => {
    if (!selectedFruit) return { soldKg: 0, revenue: 0, transactions: [] };
    const targetName = (selectedFruit.fruit_type || '').toLowerCase();
    const unitPrice = Number(selectedFruit.price_per_kg || selectedFruit.unit_price) || 100;
    let soldKg = 0;
    let revenue = 0;
    const transactions = [];

    salesList.forEach((sale) => {
      const breakdown = sale.fruit_breakdown || sale.breakdown || [];
      let matched = false;

      if (breakdown.length > 0) {
        breakdown.forEach((b) => {
          if ((b.fruit_type || '').toLowerCase() === targetName) {
            matched = true;
            const w = Number(b.weight_kg || b.weight) || (b.total_price ? Number(b.total_price) / unitPrice : 0);
            const p = Number(b.total_price || b.price) || (w * unitPrice);
            if (w > 0) {
              soldKg += w;
              revenue += p;
              transactions.push({
                date: sale.purchased_at ? new Date(sale.purchased_at).toLocaleDateString() : 'Today',
                type: 'sale',
                label: 'Sale (Customer purchase)',
                weight: -w,
                isGreen: false
              });
            }
          }
        });
      }

      if (!matched && sale.items && Array.isArray(sale.items)) {
        sale.items.forEach((item) => {
          const fName = (item.fruit_type || item.fruit || '').toLowerCase();
          if (fName === targetName) {
            const totalPrice = Number(item.total_price || item.price || sale.total_amount) || 0;
            const w = Number(item.weight_kg || item.weight) || (totalPrice > 0 ? totalPrice / unitPrice : (Number(item.quantity || 1) * 0.25));
            const p = totalPrice > 0 ? totalPrice : (w * unitPrice);
            if (w > 0) {
              soldKg += w;
              revenue += p;
              transactions.push({
                date: sale.purchased_at ? new Date(sale.purchased_at).toLocaleDateString() : 'Today',
                type: 'sale',
                label: 'Sale (Customer purchase)',
                weight: -w,
                isGreen: false
              });
            }
          }
        });
      }
    });

    return { soldKg, revenue, transactions };
  }, [selectedFruit, salesList]);

  const currentCalculatedStock = useMemo(() => {
    const base = Number(baseStock) || 0;
    const sold = fruitSalesStats.soldKg;
    const manualDelta = (stockLogsMap[selectedFruit?.fruit_type] || []).reduce((acc, curr) => {
      return acc + (curr.isGreen ? Math.abs(curr.weight) : -Math.abs(curr.weight));
    }, 0);
    return Math.max(0, base + manualDelta - sold);
  }, [baseStock, fruitSalesStats.soldKg, stockLogsMap, selectedFruit]);

  const combinedFruitHistory = useMemo(() => {
    if (!selectedFruit) return [];
    const fKey = selectedFruit.fruit_type;
    const manualLogs = stockLogsMap[fKey] || [];
    const saleLogs = fruitSalesStats.transactions;
    return [...manualLogs, ...saleLogs];
  }, [selectedFruit, stockLogsMap, fruitSalesStats]);

  const handleOpenEdit = (fruit) => {
    setSelectedFruit(fruit);
    setEditPrice(String(fruit.price_per_kg || fruit.unit_price || '100'));
    const initialStk = Number(fruit.stock_count != null ? fruit.stock_count : (fruit.stock_kg || 0));
    setBaseStock(initialStk);
    setSupplierName(fruit.supplier_name || 'Valenzuela Local Supplier');
    setAdjustmentQty('');
    setStockAdjustmentMode('add');
  };

  const handleApplyStockAdjustment = async () => {
    const qty = parseFloat(adjustmentQty);
    if (isNaN(qty) || qty <= 0) {
      Alert.alert('Invalid Quantity', 'Please enter a valid weight in kg.');
      return;
    }
    const isAdd = stockAdjustmentMode === 'add';
    const newLog = {
      date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      type: isAdd ? 'delivery' : 'adjustment',
      label: isAdd ? 'Stock added (New delivery)' : 'Stock adjusted',
      weight: isAdd ? qty : -qty,
      isGreen: isAdd
    };

    const fKey = selectedFruit.fruit_type;
    const updatedLogsMap = {
      ...stockLogsMap,
      [fKey]: [newLog, ...(stockLogsMap[fKey] || [])]
    };
    setStockLogsMap(updatedLogsMap);
    await AsyncStorage.setItem(STORAGE_STOCK_LOGS_KEY, JSON.stringify(updatedLogsMap));

    setAdjustmentQty('');
    Alert.alert('Applied', 'Stock successfully adjusted!');
  };

  const handleClearFruitStockHistory = async () => {
    if (!selectedFruit) return;
    Alert.alert(
      'Clear Stock History?',
      `Are you sure you want to clear manual stock history logs for ${selectedFruit.fruit_type}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            const fKey = selectedFruit.fruit_type;
            const updated = { ...stockLogsMap };
            delete updated[fKey];
            setStockLogsMap(updated);
            await AsyncStorage.setItem(STORAGE_STOCK_LOGS_KEY, JSON.stringify(updated));
            Alert.alert('Cleared', 'Stock history logs have been cleared.');
          }
        }
      ]
    );
  };

  const handleClearSalesHistory = () => {
    Alert.alert(
      'Clear Sales History?',
      'Are you sure you want to clear all recorded sales transactions and receipts?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: async () => {
            setSalesList([]);
            setReceipts([]);
            await AsyncStorage.removeItem(STORAGE_RECEIPTS_KEY);
            Alert.alert('Cleared', 'Sales history has been reset.');
          }
        }
      ]
    );
  };

  const handleSaveChanges = async () => {
    if (!selectedFruit) return;
    setSaving(true);
    try {
      const finalStock = currentCalculatedStock;
      const res = await fetch(`${BASE_URL}/api/inventory/${encodeURIComponent(selectedFruit.fruit_type)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vendor_id: currentUser.id,
          price_per_kg: parseFloat(editPrice) || 100,
          stock_count: finalStock,
          stock_kg: finalStock,
          supplier_name: supplierName.trim() || 'Valenzuela Local Supplier',
        }),
      });

      const resJson = await res.json();
      if (res.ok && resJson.success) {
        Alert.alert('Success', `Updated details for ${selectedFruit.fruit_type}!`);
        await fetchVendorInventory();
        setSelectedFruit(null);
      } else {
        Alert.alert('Error', resJson.message || 'Failed to save updates.');
      }
    } catch (err) {
      Alert.alert('Connection Error', 'Could not reach server.');
    } finally {
      setSaving(false);
    }
  };

  // Archive Fruit (Soft Delete)
  const handleArchiveFruit = (fruitType) => {
    Alert.alert(
      'Archive Fruit?',
      `Are you sure you want to archive "${fruitType}"? It will be moved to Archived Records and can be restored at any time.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Archive',
          style: 'destructive',
          onPress: async () => {
            try {
              const res = await fetch(`${BASE_URL}/api/inventory/${encodeURIComponent(fruitType)}?vendor_id=${currentUser.id}`, {
                method: 'DELETE',
              });
              const data = await res.json();
              if (res.ok && data.success) {
                Alert.alert('Archived', data.message);
                await fetchVendorInventory();
                setSelectedFruit(null);
              } else {
                throw new Error(data.message || 'Failed to archive on server.');
              }
            } catch (err) {
              Alert.alert('Error', err.message || 'Connection error.');
            }
          }
        }
      ]
    );
  };

  // Restore Fruit
  const handleRestoreFruit = async (fruitType) => {
    try {
      const res = await fetch(`${BASE_URL}/api/inventory/${encodeURIComponent(fruitType)}/restore?vendor_id=${currentUser.id}`, {
        method: 'POST',
      });
      const data = await res.json();
      if (res.ok && data.success) {
        Alert.alert('Restored', `${fruitType} has been returned to active inventory.`);
        await fetchVendorInventory();
      } else {
        Alert.alert('Error', data.message || 'Could not restore fruit.');
      }
    } catch (err) {
      Alert.alert('Error', 'Connection error.');
    }
  };

  // Permanent Hard Delete Fruit
  const handlePermanentDeleteFruit = (fruitType) => {
    Alert.alert(
      'Permanent Deletion',
      `Are you sure you want to permanently delete "${fruitType}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Forever',
          style: 'destructive',
          onPress: async () => {
            try {
              const res = await fetch(
                `${BASE_URL}/api/inventory/${encodeURIComponent(fruitType)}/permanent?vendor_id=${currentUser?.id || ''}`,
                { method: 'DELETE' }
              );
              const data = await res.json();
              if (res.ok && data.success) {
                Alert.alert('Deleted', data.message);
                await fetchVendorInventory();
              } else {
                Alert.alert('Error', data.message || 'Could not delete item.');
              }
            } catch (err) {
              Alert.alert('Error', 'Connection error.');
            }
          }
        }
      ]
    );
  };

  const handleCreateNewFruit = async () => {
    if (!currentUser?.synced_kiosk_code) {
      Alert.alert('Kiosk Required', 'Mag-sync muna sa kiosk bago magdagdag ng prutas.');
      return;
    }
    if (!newFruitName.trim()) {
      Alert.alert('Kulang na Datos', 'Ilagay ang pangalan ng prutas.');
      return;
    }
    try {
      const res = await fetch(`${BASE_URL}/api/inventory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vendor_id: currentUser.id,
          fruit_type: newFruitName.trim(),
          stock_kg: parseFloat(newStockKg) || 50,
          stock_count: parseFloat(newStockKg) || 50,
          price_per_kg: parseFloat(newPricePerKg) || 100,
          supplier_name: newSupplierName.trim() || 'Valenzuela Local Market',
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        Alert.alert('Tagumpay', data.message);
        setIsAddModalOpen(false);
        setNewFruitName('');
        setNewStockKg('50');
        setNewPricePerKg('100');
        setNewSupplierName('');
        fetchVendorInventory();
      } else {
        Alert.alert('Error', data.message || 'Could not add fruit.');
      }
    } catch (err) {
      Alert.alert('Error', 'May problema sa koneksyon.');
    }
  };

  const handleSyncWithKiosk = async () => {
    const code = kioskCodeInput.trim().toUpperCase();
    if (!code) {
      Alert.alert('Missing Code', 'Please enter a Kiosk code (e.g. KSK-VAL-01).');
      return;
    }

    setSyncingKiosk(true);
    try {
      const res = await fetch(`${BASE_URL}/api/kiosk/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kiosk_code: code,
          vendor_id: currentUser.id,
          username: currentUser.username
        })
      });

      const resJson = await res.json();
      if (!res.ok || !resJson.success) {
        Alert.alert('Sync Blocked', resJson.message || 'Failed to sync with this kiosk.');
        return;
      }

      const updatedUser = { ...currentUser, synced_kiosk_code: resJson.kiosk_code };
      setCurrentUser(updatedUser);
      await AsyncStorage.setItem(STORAGE_AUTH_USER_KEY, JSON.stringify(updatedUser));
      setIsSyncModalOpen(false);
      setKioskCodeInput('');
      Alert.alert('Kiosk Paired', resJson.message);
    } catch (err) {
      Alert.alert('Sync Error', 'Could not reach server.');
    } finally {
      setSyncingKiosk(false);
    }
  };

  const handleUnsyncKiosk = () => {
    Alert.alert(
      'Unsync Kiosk?',
      `Are you sure you want to disconnect from ${currentUser?.synced_kiosk_code}? Another vendor will then be able to claim it.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unsync',
          style: 'destructive',
          onPress: async () => {
            try {
              const res = await fetch(`${BASE_URL}/api/kiosk/unsync`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ vendor_id: currentUser.id })
              });

              if (res.ok) {
                const updatedUser = { ...currentUser, synced_kiosk_code: null };
                setCurrentUser(updatedUser);
                await AsyncStorage.setItem(STORAGE_AUTH_USER_KEY, JSON.stringify(updatedUser));
                
                // Reset state to empty
                setInventoryList([]);
                setSalesList([]);
                setServerHistory([]);
                Alert.alert('Unpaired', 'Kiosk has been released.');
              }
            } catch (err) {
              Alert.alert('Error', 'Could not reach server.');
            }
          }
        }
      ]
    );
  };

  const handleBarcodeScanned = async ({ data }) => {
    if (scanned || loading) return;
    setScanned(true);
    setLoading(true);

    const rawData = String(data).trim();
    try {
      if (rawData.startsWith('siglaani://receipt/') || rawData.startsWith('TXN_')) {
        const txnId = rawData.replace('siglaani://receipt/', '').trim();
        const res = await fetch(`${BASE_URL}/api/receipt/${txnId}`);
        if (!res.ok) throw new Error(`Receipt ${txnId} not found.`);
        const receiptData = await res.json();

        const updated = [receiptData, ...receipts.filter(r => r.transaction_id !== txnId)];
        setReceipts(updated);
        await AsyncStorage.setItem(STORAGE_RECEIPTS_KEY, JSON.stringify(updated));
        checkFruitSpoilageOnLaunch(updated);

        Alert.alert('Receipt Synced', `Naidagdag ang resibo ng ${receiptData.total_items || 1} prutas sa basket!`);
        setConsumerScreen('basket');
      } else {
        const scanId = rawData.replace('siglaani://inspection/', '').trim();
        const res = await fetch(`${BASE_URL}/api/scan/${scanId}`);
        if (!res.ok) throw new Error(`Scan #${scanId} not found.`);
        const scanData = await res.json();

        const updated = [scanData, ...inspections.filter(i => (i.scan_id || i.id) !== (scanData.scan_id || scanData.id))];
        setInspections(updated);
        await AsyncStorage.setItem(STORAGE_INSPECTIONS_KEY, JSON.stringify(updated));

        Alert.alert('Inspection Logged', `Nai-save ang scan para sa ${scanData.fruit_type || scanData.fruit}!`);
        setConsumerScreen('basket');
      }
    } catch (err) {
      Alert.alert('Scan Failed', err.message || 'Could not fetch data.');
    } finally {
      setLoading(false);
      setScanned(false);
    }
  };

  const toggleExpand = (txnId) => {
    setExpandedTxn(prev => (prev === txnId ? null : txnId));
  };

  const confirmDeleteReceipt = (txnId) => {
    Alert.alert(
      'Burahin ang Resibo?',
      `Nais mo bang tanggalin ang resibong ${txnId}?`,
      [
        { text: 'Kanselahin', style: 'cancel' },
        {
          text: 'Burahin',
          style: 'destructive',
          onPress: async () => {
            const filtered = receipts.filter(r => r.transaction_id !== txnId);
            setReceipts(filtered);
            await AsyncStorage.setItem(STORAGE_RECEIPTS_KEY, JSON.stringify(filtered));
          }
        }
      ]
    );
  };

  const confirmDeleteInspection = (idToRemove) => {
    Alert.alert(
      'Burahin ang Inspection Log?',
      'Nais mo bang tanggalin ang inspection result na ito?',
      [
        { text: 'Kanselahin', style: 'cancel' },
        {
          text: 'Burahin',
          style: 'destructive',
          onPress: async () => {
            const filtered = inspections.filter(i => (i.scan_id || i.id) !== idToRemove);
            setInspections(filtered);
            await AsyncStorage.setItem(STORAGE_INSPECTIONS_KEY, JSON.stringify(filtered));
          }
        }
      ]
    );
  };

  const totalScans = serverHistory.length;
  const fruitCounts = {};
  let ripeCount = 0;
  serverHistory.forEach(item => {
    const name = item.fruit || item.fruit_type || 'Unknown';
    fruitCounts[name] = (fruitCounts[name] || 0) + 1;
    const cond = (item.condition || item.condition_label || item.status || '').toLowerCase();
    if (cond.includes('hinog') || cond.includes('ripe')) ripeCount++;
  });
  let topFruit = 'N/A';
  let maxCount = 0;
  Object.entries(fruitCounts).forEach(([fruit, count]) => {
    if (count > maxCount) { maxCount = count; topFruit = fruit; }
  });
  const freshnessRate = totalScans > 0 ? Math.round((ripeCount / totalScans) * 100) : 0;

  if (!currentUser) {
    return (
      <LoginScreen
        onLoginSuccess={(user) => {
          setCurrentUser(user);
          setRole(user.role);
        }}
      />
    );
  }

  return (
    <SafeAreaView style={vendorStyles.container} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="light-content" backgroundColor="#0b1f0d" />

      {/* ── PERSISTENT ORIGINAL GREEN HEADER ── */}
      <View style={vendorStyles.originalHeader}>
        <View style={vendorStyles.headerLeftGroup}>
          <Ionicons name="leaf" size={18} color="#7EE84A" />
          <View>
            <Text style={vendorStyles.headerTitleText}>SIGLA ANI</Text>
            <Text style={vendorStyles.headerSubtitleText}>
              {role === 'vendor' ? 'Vendor Management Portal' : 'Consumer Fresh Basket'}
            </Text>
          </View>
        </View>

        <TouchableOpacity
          style={vendorStyles.roleBadgeBtn}
          onPress={handleLogout}
        >
          <Text style={vendorStyles.roleBadgeBtnText}>
            Sign Out ⇥
          </Text>
        </TouchableOpacity>
      </View>

      {/* ── VENDOR MODE ── */}
      {role === 'vendor' ? (
        selectedFruit ? (
          /* ── EDIT INVENTORY SCREEN ── */
          <ScrollView style={vendorStyles.editScrollBody} showsVerticalScrollIndicator={false}>
            <View style={vendorStyles.editCardContainer}>
              <View style={vendorStyles.editFruitIdentityRow}>
                <View style={vendorStyles.editFruitNameBox}>
                  <Text style={vendorStyles.fieldLabelSmall}>Fruit Name</Text>
                  <View style={vendorStyles.fruitNameDisplayBox}>
                    <Text style={vendorStyles.dropdownValueText}>{selectedFruit.fruit_type}</Text>
                  </View>
                </View>

                <View style={vendorStyles.idTagPill}>
                  <Text style={vendorStyles.idTagText}>
                    ID: FR-{String(selectedFruit.id || 1).padStart(3, '0')}
                  </Text>
                </View>
              </View>

              <View style={vendorStyles.twoColGrid}>
                <View style={vendorStyles.inputCol}>
                  <Text style={vendorStyles.fieldLabelSmall}>Current Stock (kg)</Text>
                  <View style={[vendorStyles.iconInputBox, vendorStyles.iconInputBoxDisabled]}>
                    <Feather name="box" size={14} color="#64748B" style={{ marginRight: 6 }} />
                    <Text style={[vendorStyles.textInputBase, { color: '#0F172A', lineHeight: 42 }]}>
                      {currentCalculatedStock.toFixed(2)}
                    </Text>
                    <Text style={vendorStyles.suffixUnit}>kg</Text>
                  </View>
                </View>

                <View style={vendorStyles.inputCol}>
                  <Text style={vendorStyles.fieldLabelSmall}>Selling Price per kg (₱)</Text>
                  <View style={vendorStyles.iconInputBox}>
                    <Text style={[vendorStyles.inputIconPrefix, { color: '#0F172A' }]}>₱</Text>
                    <TextInput
                      style={vendorStyles.textInputBase}
                      value={editPrice}
                      onChangeText={setEditPrice}
                      keyboardType="decimal-pad"
                    />
                  </View>
                </View>
              </View>

              <View style={vendorStyles.twoColGrid}>
                <View style={vendorStyles.inputCol}>
                  <Text style={vendorStyles.fieldLabelSmall}>Total Sold (kg)</Text>
                  <View style={[vendorStyles.iconInputBox, vendorStyles.iconInputBoxDisabled]}>
                    <Feather name="trending-up" size={14} color="#94A3B8" style={{ marginRight: 6 }} />
                    <Text style={[vendorStyles.textInputBase, { color: '#64748B', lineHeight: 42 }]}>
                      {fruitSalesStats.soldKg.toFixed(2)}
                    </Text>
                    <Text style={vendorStyles.suffixUnit}>kg</Text>
                  </View>
                </View>

                <View style={vendorStyles.inputCol}>
                  <Text style={vendorStyles.fieldLabelSmall}>Total Revenue (₱)</Text>
                  <View style={[vendorStyles.iconInputBox, vendorStyles.iconInputBoxDisabled]}>
                    <Text style={[vendorStyles.inputIconPrefix, { color: '#94A3B8' }]}>₱</Text>
                    <Text style={[vendorStyles.textInputBase, { color: '#64748B', lineHeight: 42 }]}>
                      {fruitSalesStats.revenue.toFixed(2)}
                    </Text>
                  </View>
                </View>
              </View>

              {/* Update Stock Adjuster Card */}
              <View style={vendorStyles.updateStockSubCard}>
                <Text style={vendorStyles.updateStockTitle}>Update Stock</Text>
                <View style={vendorStyles.radioGroupRow}>
                  <TouchableOpacity style={vendorStyles.radioOption} onPress={() => setStockAdjustmentMode('add')}>
                    <View style={[vendorStyles.radioDotOuter, stockAdjustmentMode === 'add' && vendorStyles.radioDotOuterActive]}>
                      {stockAdjustmentMode === 'add' && <View style={vendorStyles.radioDotInner} />}
                    </View>
                    <Text style={vendorStyles.radioLabel}>Add Stock (New Delivery)</Text>
                  </TouchableOpacity>

                  <TouchableOpacity style={vendorStyles.radioOption} onPress={() => setStockAdjustmentMode('deduct')}>
                    <View style={[vendorStyles.radioDotOuter, stockAdjustmentMode === 'deduct' && vendorStyles.radioDotOuterActive]}>
                      {stockAdjustmentMode === 'deduct' && <View style={vendorStyles.radioDotInner} />}
                    </View>
                    <Text style={vendorStyles.radioLabel}>Deduct Stock</Text>
                  </TouchableOpacity>
                </View>

                <View style={vendorStyles.twoColGrid}>
                  <View style={vendorStyles.inputCol}>
                    <Text style={vendorStyles.fieldLabelSmall}>Quantity (kg)</Text>
                    <View style={vendorStyles.iconInputBox}>
                      <Feather name="box" size={14} color="#64748B" style={{ marginRight: 6 }} />
                      <TextInput
                        style={vendorStyles.textInputBase}
                        placeholder="e.g. 50.00"
                        placeholderTextColor="#94A3B8"
                        value={adjustmentQty}
                        onChangeText={setAdjustmentQty}
                        keyboardType="decimal-pad"
                      />
                      <Text style={vendorStyles.suffixUnit}>kg</Text>
                    </View>
                  </View>

                  <View style={vendorStyles.inputCol}>
                    <Text style={vendorStyles.fieldLabelSmall}>Date Received</Text>
                    <View style={vendorStyles.iconInputBox}>
                      <Feather name="calendar" size={14} color="#64748B" style={{ marginRight: 6 }} />
                      <Text style={[vendorStyles.textInputBase, { fontSize: 12, color: '#334155', lineHeight: 42 }]}>
                        {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </Text>
                    </View>
                  </View>
                </View>

                <TouchableOpacity style={vendorStyles.applyStockAdjustmentBtn} onPress={handleApplyStockAdjustment}>
                  <Feather name="plus" size={14} color="#FFFFFF" />
                  <Text style={vendorStyles.applyStockAdjustmentBtnText}>
                    {stockAdjustmentMode === 'add' ? 'Add Stock' : 'Deduct Stock'}
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Supplier Name */}
              <View style={{ marginBottom: 8 }}>
                <Text style={vendorStyles.fieldLabelSmall}>Supplier Name</Text>
                <View style={vendorStyles.iconInputBox}>
                  <Feather name="truck" size={14} color="#64748B" style={{ marginRight: 6 }} />
                  <TextInput
                    style={[vendorStyles.textInputBase, { color: '#0F172A' }]}
                    placeholder="e.g. Valenzuela Local Supplier"
                    placeholderTextColor="#94A3B8"
                    value={supplierName}
                    onChangeText={setSupplierName}
                  />
                </View>
              </View>
            </View>

            {/* Stock History */}
            <View style={vendorStyles.editCardContainer}>
              <View style={vendorStyles.stockHistoryHeaderRow}>
                <View style={vendorStyles.stockHistoryTitleGroup}>
                  <Feather name="clock" size={15} color="#0F172A" />
                  <Text style={vendorStyles.stockHistoryTitle}>Stock History</Text>
                </View>
                <TouchableOpacity onPress={() => setIsHistoryModalOpen(true)}>
                  <Text style={vendorStyles.viewAllText}>View All &gt;</Text>
                </TouchableOpacity>
              </View>

              {combinedFruitHistory.length === 0 ? (
                <Text style={{ fontSize: 12, color: '#64748B', paddingVertical: 6 }}>No stock modifications or sales yet.</Text>
              ) : (
                combinedFruitHistory.slice(0, 2).map((h, i) => (
                  <View key={i} style={vendorStyles.historyTimelineItem}>
                    <View style={vendorStyles.historyItemLeft}>
                      <View style={[vendorStyles.historyDot, h.isGreen ? vendorStyles.historyDotGreen : vendorStyles.historyDotRed]} />
                      <View>
                        <Text style={vendorStyles.historyDateText}>{h.date}</Text>
                        <Text style={vendorStyles.historySubText}>{h.label}</Text>
                      </View>
                    </View>
                    <Text style={[vendorStyles.historyWeightText, h.isGreen ? vendorStyles.historyWeightGreen : vendorStyles.historyWeightRed]}>
                      {h.isGreen ? `+${h.weight.toFixed(2)}` : `${h.weight.toFixed(2)}`} kg
                    </Text>
                  </View>
                ))
              )}
            </View>

            {/* Form Actions */}
            <View style={vendorStyles.bottomActionRow}>
              <TouchableOpacity style={vendorStyles.cancelBtn} onPress={() => setSelectedFruit(null)}>
                <Feather name="x" size={16} color="#475569" />
                <Text style={vendorStyles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity style={vendorStyles.saveChangesBtn} onPress={handleSaveChanges} disabled={saving}>
                {saving ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <Feather name="check" size={16} color="#FFFFFF" />
                    <Text style={vendorStyles.saveChangesBtnText}>Save Changes</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>

            {/* Archive Fruit Option (Replaces Hard Delete) */}
            <TouchableOpacity style={vendorStyles.deleteFruitBtn} onPress={() => handleArchiveFruit(selectedFruit.fruit_type)}>
              <Feather name="archive" size={16} color={STATUS_COLORS.FAILED} />
              <Text style={[vendorStyles.deleteFruitBtnText, { color: STATUS_COLORS.FAILED }]}>
                Archive Fruit (Move to Archive)
              </Text>
            </TouchableOpacity>
          </ScrollView>
        ) : (
          /* ── MAIN 4-TAB VENDOR BODY ── */
          <View style={{ flex: 1 }}>
            {/* TAB 1: DASHBOARD */}
            {vendorNavTab === 'dashboard' && (
              <ScrollView contentContainerStyle={{ padding: 16 }}>
                <Text style={vendorStyles.pageHeading}>Dashboard</Text>
                <Text style={vendorStyles.pageSubheading}>Kiosk analytics, freshness metrics and status.</Text>

                <View style={[vendorStyles.metricCard, { borderLeftColor: STATUS_COLORS.SUCCESS }]}>
                  <Text style={vendorStyles.metricLabel}>Kabuuang Na-scan sa Kiosk</Text>
                  <Text style={vendorStyles.metricValue}>{totalScans}</Text>
                </View>

                <View style={[vendorStyles.metricCard, { borderLeftColor: STATUS_COLORS.WARNING }]}>
                  <Text style={vendorStyles.metricLabel}>Nangungunang Prutas</Text>
                  <Text style={vendorStyles.metricValue}>{topFruit} {maxCount > 0 ? `(${maxCount} scans)` : ''}</Text>
                </View>

                <View style={[vendorStyles.metricCard, { borderLeftColor: '#3b82f6' }]}>
                  <Text style={vendorStyles.metricLabel}>Freshness Rate (Hinog)</Text>
                  <Text style={vendorStyles.metricValue}>{freshnessRate}%</Text>
                </View>

                <View style={vendorStyles.sectionCard}>
                  <Text style={vendorStyles.sectionCardTitle}>Distribusyon ng Bawat Prutas</Text>
                  {Object.keys(fruitCounts).length === 0 ? (
                    <Text style={{ color: '#888', fontSize: 13 }}>Wala pang mga na-scan na prutas.</Text>
                  ) : (
                    Object.entries(fruitCounts).map(([fruit, count]) => {
                      const percentage = totalScans > 0 ? Math.round((count / totalScans) * 100) : 0;
                      return (
                        <View key={fruit} style={{ marginBottom: 10 }}>
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}>
                            <Text style={{ fontSize: 13, fontWeight: '700', color: '#111' }}>{fruit}</Text>
                            <Text style={{ fontSize: 12, color: '#666' }}>{count} scans ({percentage}%)</Text>
                          </View>
                          <View style={vendorStyles.progressBarTrack}>
                            <View style={[vendorStyles.progressBarFill, { width: `${percentage}%` }]} />
                          </View>
                        </View>
                      );
                    })
                  )}
                </View>

                <View style={vendorStyles.sectionCard}>
                  <Text style={vendorStyles.sectionCardTitle}>Kiosk Live Status</Text>
                  <View style={vendorStyles.statusItemRow}>
                    <Text style={vendorStyles.statusItemLabel}>Server Host:</Text>
                    <Text style={vendorStyles.statusItemVal}>{BASE_URL}</Text>
                  </View>
                  <View style={vendorStyles.statusItemRow}>
                    <Text style={vendorStyles.statusItemLabel}>Active Scans in Database:</Text>
                    <Text style={vendorStyles.statusItemVal}>{serverHistory.length} records</Text>
                  </View>
                  <View style={[vendorStyles.statusItemRow, { borderBottomWidth: 0 }]}>
                    <Text style={vendorStyles.statusItemLabel}>Total Stock Remaining:</Text>
                    <Text style={vendorStyles.statusItemVal}>
                      {inventoryList.reduce((acc, curr) => acc + (parseFloat(curr.stock_count) || 0), 0).toFixed(2)} kg
                    </Text>
                  </View>
                </View>
              </ScrollView>
            )}

            {/* TAB 2: INVENTORY */}
            {vendorNavTab === 'inventory' && (
              <View style={{ flex: 1 }}>
                <View style={vendorStyles.contentBanner}>
                  <Text style={vendorStyles.pageHeading}>Inventory</Text>
                  <Text style={vendorStyles.pageSubheading}>Manage your fruit stock, prices and archives.</Text>

                  {/* ── ARCHIVE TOGGLE SWITCHER ── */}
                  <View style={inlineStyles.archiveSwitchWrap}>
                    <TouchableOpacity
                      style={[inlineStyles.archiveSwitchBtn, inventoryTab === 'active' && inlineStyles.archiveSwitchBtnActive]}
                      onPress={() => setInventoryTab('active')}
                      activeOpacity={0.7}
                    >
                      <Text style={[inlineStyles.archiveSwitchText, inventoryTab === 'active' && inlineStyles.archiveSwitchTextActive]}>
                        Active Stock
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[inlineStyles.archiveSwitchBtn, inventoryTab === 'archived' && inlineStyles.archiveSwitchBtnActive]}
                      onPress={() => setInventoryTab('archived')}
                      activeOpacity={0.7}
                    >
                      <Text style={[inlineStyles.archiveSwitchText, inventoryTab === 'archived' && inlineStyles.archiveSwitchTextActive]}>
                        Archived Records
                      </Text>
                    </TouchableOpacity>
                  </View>

                  <View style={vendorStyles.searchAndAddRow}>
                    <View style={vendorStyles.searchBarWrap}>
                      <Feather name="search" size={15} color="#94A3B8" />
                      <TextInput
                        style={vendorStyles.searchInput}
                        placeholder="Search fruit..."
                        placeholderTextColor="#94A3B8"
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                      />
                    </View>
                    {inventoryTab === 'active' && currentUser?.synced_kiosk_code && (
                      <TouchableOpacity style={vendorStyles.addFruitBtn} onPress={() => setIsAddModalOpen(true)}>
                        <Feather name="plus" size={14} color="#FFFFFF" />
                        <Text style={vendorStyles.addFruitBtnText}>Add Fruit</Text>
                      </TouchableOpacity>
                    )}
                  </View>

                  {inventoryTab === 'active' && (
                    <View style={vendorStyles.filterPillRow}>
                      {['All', 'Available', 'Out of Stock'].map(pill => (
                        <TouchableOpacity
                          key={pill}
                          style={[vendorStyles.filterPill, activeFilter === pill && vendorStyles.filterPillActive]}
                          onPress={() => setActiveFilter(pill)}
                        >
                          <Text style={[vendorStyles.filterPillText, activeFilter === pill && vendorStyles.filterPillTextActive]}>
                            {pill}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </View>

                <View style={vendorStyles.tableHeaderRow}>
                  <Text style={[vendorStyles.tableHeaderColText, { flex: 1.2 }]}>Fruit</Text>
                  <Text style={[vendorStyles.tableHeaderColText, { flex: 1.3 }]}>Stock (kg)</Text>
                  <Text style={[vendorStyles.tableHeaderColText, { flex: 1 }]}>Price / kg</Text>
                  <Text style={[vendorStyles.tableHeaderColText, { textAlign: 'right' }]}>Actions</Text>
                </View>

                {loadingInv ? (
                  <ActivityIndicator size="large" color={STATUS_COLORS.PRIMARY_GREEN} style={{ marginTop: 40 }} />
                ) : (
                  <FlatList
                    data={filteredInventory}
                    keyExtractor={item => String(item.id || item.fruit_type)}
                    renderItem={({ item }) => {
                      const stock = Number(item.stock_count) || 0;
                      const price = Number(item.price_per_kg || item.unit_price) || 0;
                      const progress = Math.min(Math.max(stock / 100, 0), 1);
                      return (
                        <View style={vendorStyles.fruitRowItem}>
                          <View style={vendorStyles.fruitRowNameCol}>
                            <Text style={vendorStyles.fruitRowName}>{item.fruit_type}</Text>
                            <Text style={vendorStyles.fruitRowUnitLabel}>Per kg</Text>
                          </View>

                          <View style={vendorStyles.fruitRowStockCol}>
                            <Text style={vendorStyles.fruitRowStockVal}>{stock.toFixed(2)} kg</Text>
                            <Text style={vendorStyles.fruitRowStockSub}>Remaining</Text>
                            <View style={vendorStyles.progressBarBg}>
                              <View style={[vendorStyles.progressBarFill, { width: `${progress * 100}%` }]} />
                            </View>
                          </View>

                          <View style={vendorStyles.fruitRowPriceCol}>
                            <Text style={vendorStyles.fruitRowPriceVal}>₱{price.toFixed(2)}</Text>
                            <Text style={vendorStyles.fruitRowPriceSub}>per kg</Text>
                          </View>

                          <View style={vendorStyles.fruitRowActionCol}>
                            {inventoryTab === 'active' ? (
                              <>
                                <TouchableOpacity
                                  style={vendorStyles.actionEditCircle}
                                  onPress={() => handleOpenEdit(item)}
                                  activeOpacity={0.7}
                                >
                                  <Feather name="edit-2" size={13} color={STATUS_COLORS.PRIMARY_GREEN} />
                                </TouchableOpacity>
                                <TouchableOpacity
                                  style={[vendorStyles.actionEditCircle, { backgroundColor: STATUS_COLORS.FAILED_BG, marginLeft: 4 }]}
                                  onPress={() => handleArchiveFruit(item.fruit_type)}
                                  activeOpacity={0.7}
                                >
                                  <Feather name="archive" size={13} color={STATUS_COLORS.FAILED} />
                                </TouchableOpacity>
                              </>
                            ) : (
                              <View style={{ flexDirection: 'row', gap: 6 }}>
                                {/* Restore button */}
                                <TouchableOpacity
                                  style={[vendorStyles.actionEditCircle, { backgroundColor: STATUS_COLORS.SUCCESS_BG, width: 34, height: 34 }]}
                                  onPress={() => handleRestoreFruit(item.fruit_type)}
                                  activeOpacity={0.7}
                                >
                                  <Feather name="rotate-ccw" size={14} color={STATUS_COLORS.SUCCESS} />
                                </TouchableOpacity>

                                {/* Permanent delete button */}
                                <TouchableOpacity
                                  style={[vendorStyles.actionEditCircle, { backgroundColor: STATUS_COLORS.FAILED_BG, width: 34, height: 34 }]}
                                  onPress={() => handlePermanentDeleteFruit(item.fruit_type)}
                                  activeOpacity={0.7}
                                >
                                  <Feather name="trash-2" size={14} color={STATUS_COLORS.FAILED} />
                                </TouchableOpacity>
                              </View>
                            )}
                          </View>
                        </View>
                      );
                    }}
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={{ paddingBottom: 20 }}
                    ListEmptyComponent={
                      <Text style={{ textAlign: 'center', marginTop: 40, color: '#94A3B8' }}>
                        {!currentUser?.synced_kiosk_code
                          ? 'No kiosk paired. Pair with a kiosk station in Profile to manage inventory.'
                          : inventoryTab === 'active'
                          ? `No fruits found matching "${activeFilter}". Tap "Add Fruit" to begin.`
                          : 'No archived fruits.'}
                      </Text>
                    }
                  />
                )}
              </View>
            )}

            {/* TAB 3: SALES WITH DATE FILTER */}
            {vendorNavTab === 'sales' && (
              <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
                <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
                  <Text style={vendorStyles.pageHeading}>Sales History</Text>
                  <Text style={vendorStyles.pageSubheading}>Transactions completed at the kiosk checkout.</Text>
                </View>

                {/* ── DATE FILTER BAR COMPONENT ── */}
                <DateFilterBar
                  selectedPreset={salesFilterPreset}
                  onSelectPreset={(preset) => setSalesFilterPreset(preset)}
                />

                {loadingSales ? (
                  <ActivityIndicator size="small" color={STATUS_COLORS.PRIMARY_GREEN} style={{ marginTop: 20 }} />
                ) : salesList.length === 0 ? (
                  <View style={[vendorStyles.sectionCard, { marginHorizontal: 16 }]}>
                    <Text style={{ color: '#64748B', textAlign: 'center', paddingVertical: 20 }}>
                      {!currentUser?.synced_kiosk_code
                        ? 'No transactions found. Connect to a kiosk station to view sales.'
                        : 'No transactions found for the selected time range.'}
                    </Text>
                  </View>
                ) : (
                  <View style={{ paddingHorizontal: 16 }}>
                    {salesList.map((sale, idx) => (
                      <View key={sale.transaction_id || idx} style={vendorStyles.saleTxnCard}>
                        <View style={vendorStyles.saleTxnHeader}>
                          <Text style={vendorStyles.saleTxnId}>{sale.transaction_id || 'TXN'}</Text>
                          <Text style={[vendorStyles.saleTxnAmount, { color: STATUS_COLORS.SUCCESS }]}>
                            ₱{Number(sale.total_amount || 25).toFixed(2)}
                          </Text>
                        </View>
                        <Text style={vendorStyles.saleTxnDate}>
                          {sale.purchased_at ? new Date(sale.purchased_at).toLocaleString() : 'Recent transaction'}
                        </Text>
                        <View style={vendorStyles.saleFruitPillRow}>
                          {(sale.items || [{ fruit_type: 'Purchased Fruit' }]).map((fruit, fIdx) => (
                            <View key={fIdx} style={vendorStyles.saleFruitPill}>
                              <Text style={vendorStyles.saleFruitPillText}>
                                {fruit.fruit_type} ({fruit.weight_kg ? `${fruit.weight_kg}kg` : `${fruit.quantity || 1} pcs`})
                              </Text>
                            </View>
                          ))}
                        </View>
                      </View>
                    ))}

                    <TouchableOpacity 
                      style={vendorStyles.clearHistoryBtn} 
                      onPress={handleClearSalesHistory}
                    >
                      <Feather name="trash-2" size={15} color={STATUS_COLORS.FAILED} />
                      <Text style={[vendorStyles.clearHistoryBtnText, { color: STATUS_COLORS.FAILED }]}>
                        Clear Sales History
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}
              </ScrollView>
            )}

            {/* TAB 4: PROFILE */}
            {vendorNavTab === 'profile' && (
              <ScrollView contentContainerStyle={{ padding: 16 }}>
                <Text style={vendorStyles.pageHeading}>Vendor Profile</Text>
                <Text style={vendorStyles.pageSubheading}>Store settings and kiosk connection.</Text>

                {/* Kiosk Pairing Card */}
                <View style={vendorStyles.sectionCard}>
                  <Text style={vendorStyles.sectionCardTitle}>Kiosk Station Pairing</Text>
                  <View style={vendorStyles.statusItemRow}>
                    <Text style={vendorStyles.statusItemLabel}>Status:</Text>
                    <Text style={[vendorStyles.statusItemVal, { color: currentUser?.synced_kiosk_code ? STATUS_COLORS.SUCCESS : STATUS_COLORS.FAILED }]}>
                      {currentUser?.synced_kiosk_code ? `Synced to ${currentUser.synced_kiosk_code}` : 'No Kiosk Paired'}
                    </Text>
                  </View>

                  {currentUser?.synced_kiosk_code ? (
                    <TouchableOpacity
                      style={[vendorStyles.clearHistoryBtn, { marginTop: 10, marginBottom: 4 }]}
                      onPress={handleUnsyncKiosk}
                    >
                      <Feather name="link-2" size={14} color={STATUS_COLORS.FAILED} />
                      <Text style={[vendorStyles.clearHistoryBtnText, { color: STATUS_COLORS.FAILED }]}>Unsync from Kiosk</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      style={[vendorStyles.applyStockAdjustmentBtn, { height: 42, marginTop: 10 }]}
                      onPress={() => setIsSyncModalOpen(true)}
                    >
                      <Feather name="radio" size={15} color="#FFFFFF" />
                      <Text style={vendorStyles.applyStockAdjustmentBtnText}>Sync with a Kiosk</Text>
                    </TouchableOpacity>
                  )}
                </View>

                <View style={vendorStyles.sectionCard}>
                  <Text style={vendorStyles.sectionCardTitle}>Store Information</Text>
                  <View style={vendorStyles.statusItemRow}>
                    <Text style={vendorStyles.statusItemLabel}>Store Name:</Text>
                    <Text style={vendorStyles.statusItemVal}>{currentUser?.full_name || 'Sigla Ani Kiosk'}</Text>
                  </View>
                  <View style={vendorStyles.statusItemRow}>
                    <Text style={vendorStyles.statusItemLabel}>Location:</Text>
                    <Text style={vendorStyles.statusItemVal}>Valenzuela City Market</Text>
                  </View>
                  <View style={[vendorStyles.statusItemRow, { borderBottomWidth: 0 }]}>
                    <Text style={vendorStyles.statusItemLabel}>Operational Status:</Text>
                    <Text style={[vendorStyles.statusItemVal, { color: STATUS_COLORS.SUCCESS }]}>Active / Online</Text>
                  </View>
                </View>

                <View style={vendorStyles.sectionCard}>
                  <Text style={vendorStyles.sectionCardTitle}>Preferences</Text>
                  <TouchableOpacity style={vendorStyles.profileOptionRow} onPress={fetchVendorInventory}>
                    <View style={vendorStyles.profileOptionLeft}>
                      <Feather name="refresh-cw" size={15} color="#1E293B" />
                      <Text style={vendorStyles.profileOptionText}>Refresh Kiosk Sync</Text>
                    </View>
                    <Feather name="chevron-right" size={16} color="#CBD5E1" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={vendorStyles.profileOptionRow}
                    onPress={handleLogout}
                  >
                    <View style={vendorStyles.profileOptionLeft}>
                      <Feather name="log-out" size={15} color={STATUS_COLORS.FAILED} />
                      <Text style={[vendorStyles.profileOptionText, { color: STATUS_COLORS.FAILED }]}>Sign Out / Switch Account</Text>
                    </View>
                    <Feather name="chevron-right" size={16} color="#CBD5E1" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[vendorStyles.profileOptionRow, { borderBottomWidth: 0 }]}
                    onPress={() => Alert.alert('Sigla Ani', 'System version 1.0.0 (Production Build)')}
                  >
                    <View style={vendorStyles.profileOptionLeft}>
                      <Feather name="info" size={15} color="#1E293B" />
                      <Text style={vendorStyles.profileOptionText}>About Application</Text>
                    </View>
                    <Feather name="chevron-right" size={16} color="#CBD5E1" />
                  </TouchableOpacity>
                </View>
              </ScrollView>
            )}

            {/* ── 4-TAB PERSISTENT BOTTOM NAVIGATION ── */}
            <View style={vendorStyles.bottomNavBar}>
              <TouchableOpacity
                style={vendorStyles.bottomNavItem}
                onPress={() => setVendorNavTab('dashboard')}
              >
                <View style={vendorNavTab === 'dashboard' ? vendorStyles.bottomNavPillActive : null}>
                  <Feather
                    name="home"
                    size={18}
                    color={vendorNavTab === 'dashboard' ? STATUS_COLORS.PRIMARY_GREEN : '#64748B'}
                  />
                </View>
                <Text style={[vendorStyles.bottomNavLabel, vendorNavTab === 'dashboard' && vendorStyles.bottomNavLabelActive]}>
                  Dashboard
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={vendorStyles.bottomNavItem}
                onPress={() => setVendorNavTab('inventory')}
              >
                <View style={vendorNavTab === 'inventory' ? vendorStyles.bottomNavPillActive : null}>
                  <Ionicons
                    name="leaf-outline"
                    size={18}
                    color={vendorNavTab === 'inventory' ? STATUS_COLORS.PRIMARY_GREEN : '#64748B'}
                  />
                </View>
                <Text style={[vendorStyles.bottomNavLabel, vendorNavTab === 'inventory' && vendorStyles.bottomNavLabelActive]}>
                  Inventory
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={vendorStyles.bottomNavItem}
                onPress={() => setVendorNavTab('sales')}
              >
                <View style={vendorNavTab === 'sales' ? vendorStyles.bottomNavPillActive : null}>
                  <Feather
                    name="trending-up"
                    size={18}
                    color={vendorNavTab === 'sales' ? STATUS_COLORS.PRIMARY_GREEN : '#64748B'}
                  />
                </View>
                <Text style={[vendorStyles.bottomNavLabel, vendorNavTab === 'sales' && vendorStyles.bottomNavLabelActive]}>
                  Sales
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={vendorStyles.bottomNavItem}
                onPress={() => setVendorNavTab('profile')}
              >
                <View style={vendorNavTab === 'profile' ? vendorStyles.bottomNavPillActive : null}>
                  <Feather
                    name="user"
                    size={18}
                    color={vendorNavTab === 'profile' ? STATUS_COLORS.PRIMARY_GREEN : '#64748B'}
                  />
                </View>
                <Text style={[vendorStyles.bottomNavLabel, vendorNavTab === 'profile' && vendorStyles.bottomNavLabelActive]}>
                  Profile
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )
      ) : (
        /* ── CONSUMER MODE ── */
        <View style={{ flex: 1, backgroundColor: '#F8FAF8' }}>
          <View style={baseStyles.navTabs}>
            <TouchableOpacity
              style={[baseStyles.tabBtn, consumerTab === 'receipts' && baseStyles.activeTabBtn]}
              onPress={() => setConsumerTab('receipts')}
            >
              <Text style={[baseStyles.tabText, consumerTab === 'receipts' && baseStyles.activeTabText]}>
                My Receipts ({receipts.length})
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[baseStyles.tabBtn, consumerTab === 'inspections' && baseStyles.activeTabBtn]}
              onPress={() => setConsumerTab('inspections')}
            >
              <Text style={[baseStyles.tabText, consumerTab === 'inspections' && baseStyles.activeTabText]}>
                Inspections ({inspections.length})
              </Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={baseStyles.body} contentContainerStyle={{ paddingBottom: 100 }}>
            {consumerTab === 'receipts' ? (
              receipts.length === 0 ? (
                <View style={{ padding: 40, alignItems: 'center' }}>
                  <Text style={{ color: '#64748B', textAlign: 'center', fontSize: 14 }}>
                    Walang laman ang iyong basket. I-scan ang QR code ng resibo pagkatapos mag-checkout sa kiosk!
                  </Text>
                </View>
              ) : (
                receipts.map((item) => {
                  const isExpanded = expandedTxn === item.transaction_id;
                  const itemList = item.items || [];
                  return (
                    <View key={item.transaction_id} style={baseStyles.card}>
                      <TouchableOpacity 
                        onPress={() => toggleExpand(item.transaction_id)}
                        onLongPress={() => confirmDeleteReceipt(item.transaction_id)}
                        delayLongPress={500}
                      >
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontSize: 16, fontWeight: '800', color: '#0F172A' }}>{item.vendor_name || 'Sigla Ani Kiosk'}</Text>
                            <Text style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>{item.purchased_at ? new Date(item.purchased_at).toLocaleString() : 'Recent Purchase'}</Text>
                            <Text style={{ fontSize: 11, fontFamily: 'monospace', color: STATUS_COLORS.PRIMARY_GREEN, marginTop: 2 }}>{item.transaction_id}</Text>
                          </View>
                          <View style={{ alignItems: 'flex-end' }}>
                            <View style={{ backgroundColor: STATUS_COLORS.SUCCESS_BG, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 }}>
                              <Text style={{ fontSize: 12, fontWeight: '800', color: STATUS_COLORS.SUCCESS }}>₱{item.total_amount || 0}</Text>
                            </View>
                            <Text style={{ fontSize: 11, color: '#64748B', marginTop: 6 }}>{isExpanded ? 'Hide ▲' : 'View Fruits ▼'}</Text>
                          </View>
                        </View>
                      </TouchableOpacity>

                      {isExpanded && (
                        <View style={{ marginTop: 14, borderTopWidth: 1, borderTopColor: '#E2E8F0', paddingTop: 12 }}>
                          {itemList.map((fruit, idx) => {
                            const imgUrl = fruit.image_url ? `${BASE_URL}${fruit.image_url}` : null;
                            const isRotten = (fruit.status || '').toLowerCase().includes('bulok') || (fruit.status || '').toLowerCase().includes('rotten');
                            const shelfLife = getShelfLifeInfo(fruit.status, item.purchased_at);

                            return (
                              <View key={idx} style={{ flexDirection: 'row', backgroundColor: '#F8FAF8', padding: 10, borderRadius: 10, marginBottom: 8, alignItems: 'center', borderWidth: 1, borderColor: '#E2E8F0' }}>
                                {imgUrl ? (
                                  <Image source={{ uri: imgUrl }} style={{ width: 50, height: 50, borderRadius: 8 }} />
                                ) : (
                                  <View style={{ width: 50, height: 50, borderRadius: 8, backgroundColor: '#CBD5E1' }} />
                                )}
                                <View style={{ flex: 1, marginLeft: 10 }}>
                                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <Text style={{ fontSize: 14, fontWeight: '800', color: '#0F172A' }}>{fruit.fruit_type}</Text>
                                    <View style={{ backgroundColor: isRotten ? STATUS_COLORS.FAILED_BG : STATUS_COLORS.SUCCESS_BG, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 }}>
                                      <Text style={{ fontSize: 10, fontWeight: '800', color: isRotten ? STATUS_COLORS.FAILED : STATUS_COLORS.SUCCESS }}>{fruit.status}</Text>
                                    </View>
                                  </View>
                                  <Text style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>⏳ {shelfLife.statusText}</Text>
                                  <Text style={{ fontSize: 11, color: '#64748B', marginTop: 1 }}>Kilo/Qty: {fruit.weight_kg ? `${fruit.weight_kg}kg` : `${fruit.quantity || 1} pcs`} (₱{fruit.total_price || 0})</Text>
                                </View>
                              </View>
                            );
                          })}
                        </View>
                      )}
                    </View>
                  );
                })
              )
            ) : (
              inspections.length === 0 ? (
                <View style={{ padding: 40, alignItems: 'center' }}>
                  <Text style={{ color: '#64748B', textAlign: 'center', fontSize: 14 }}>
                    Walang naka-save na inspection logs. I-scan ang QR sa kiosk screen upang i-log ang prutas.
                  </Text>
                </View>
              ) : (
                inspections.map((item) => {
                  const isRotten = (item.status || '').toLowerCase().includes('bulok') || (item.status || '').toLowerCase().includes('rotten');
                  const itemId = item.scan_id || item.id;

                  return (
                    <View key={itemId} style={baseStyles.card}>
                      <TouchableOpacity 
                        onLongPress={() => confirmDeleteInspection(itemId)}
                        delayLongPress={500}
                      >
                        <View style={{ padding: 4 }}>
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Text style={{ fontSize: 16, fontWeight: '800', color: '#0F172A' }}>{item.fruit_type || item.fruit}</Text>
                            <View style={{ backgroundColor: isRotten ? STATUS_COLORS.FAILED_BG : STATUS_COLORS.SUCCESS_BG, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }}>
                              <Text style={{ fontSize: 11, fontWeight: '800', color: isRotten ? STATUS_COLORS.FAILED : STATUS_COLORS.SUCCESS }}>{item.status}</Text>
                            </View>
                          </View>
                          <Text style={{ fontSize: 12, fontStyle: 'italic', color: '#64748B', marginTop: 2 }}>{item.scientific || 'SIGLA ANI AI'}</Text>
                          <Text style={{ fontSize: 12, color: '#64748B', marginTop: 4 }}>Confidence: {Math.round(item.confidence || 85)}%</Text>
                        </View>
                        {item.recommendation ? (
                          <View style={baseStyles.recoBox}>
                            <Text style={baseStyles.recoTitle}>Storage Recommendation:</Text>
                            <Text style={baseStyles.recoText}>"{item.recommendation}"</Text>
                          </View>
                        ) : null}
                      </TouchableOpacity>
                    </View>
                  );
                })
              )
            )}
          </ScrollView>

          <TouchableOpacity
            style={{ position: 'absolute', bottom: 20, right: 20, backgroundColor: STATUS_COLORS.PRIMARY_GREEN, width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', elevation: 6, shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.3, shadowRadius: 4 }}
            onPress={() => setConsumerScreen(prev => (prev === 'scanner' ? 'basket' : 'scanner'))}
          >
            <Feather name="camera" size={24} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      )}

      {/* ── SYNC WITH KIOSK MODAL ── */}
      <Modal visible={isSyncModalOpen} transparent animationType="slide" onRequestClose={() => setIsSyncModalOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 20 }}>
            <Text style={{ fontSize: 18, fontWeight: '800', color: '#0F172A', marginBottom: 4 }}>Sync with a Kiosk</Text>
            <Text style={{ fontSize: 12, color: '#64748B', marginBottom: 14 }}>
              Enter the unique code displayed on the physical kiosk monitor (e.g. KSK-VAL-01).
            </Text>

            <Text style={vendorStyles.fieldLabelSmall}>Kiosk Station Code</Text>
            <TextInput
              style={[vendorStyles.modalTextInput, { textTransform: 'uppercase' }]}
              placeholder="KSK-VAL-01"
              placeholderTextColor="#94A3B8"
              autoCapitalize="characters"
              value={kioskCodeInput}
              onChangeText={setKioskCodeInput}
            />

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 6 }}>
              <TouchableOpacity style={[vendorStyles.cancelBtn, { height: 44 }]} onPress={() => setIsSyncModalOpen(false)}>
                <Text style={vendorStyles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[vendorStyles.saveChangesBtn, { height: 44 }]} onPress={handleSyncWithKiosk} disabled={syncingKiosk}>
                {syncingKiosk ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={vendorStyles.saveChangesBtnText}>Claim & Sync</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── STOCK HISTORY "VIEW ALL" MODAL ── */}
      <Modal visible={isHistoryModalOpen} transparent animationType="slide" onRequestClose={() => setIsHistoryModalOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 20, maxHeight: '85%' }}>
            <Text style={{ fontSize: 18, fontWeight: '800', color: '#0F172A', marginBottom: 4 }}>
              Stock History: {selectedFruit?.fruit_type}
            </Text>
            <Text style={{ fontSize: 12, color: '#64748B', marginBottom: 16 }}>Complete log of deliveries, adjustments, and customer purchases.</Text>

            <ScrollView contentContainerStyle={{ paddingBottom: 16 }}>
              {combinedFruitHistory.length === 0 ? (
                <Text style={{ textAlign: 'center', color: '#94A3B8', paddingVertical: 20 }}>No logs available.</Text>
              ) : (
                combinedFruitHistory.map((h, i) => (
                  <View key={i} style={[vendorStyles.historyTimelineItem, { borderBottomWidth: 1, borderBottomColor: '#F1F5F9', paddingBottom: 10, marginBottom: 10 }]}>
                    <View style={vendorStyles.historyItemLeft}>
                      <View style={[vendorStyles.historyDot, h.isGreen ? vendorStyles.historyDotGreen : vendorStyles.historyDotRed]} />
                      <View>
                        <Text style={vendorStyles.historyDateText}>{h.date}</Text>
                        <Text style={vendorStyles.historySubText}>{h.label}</Text>
                      </View>
                    </View>
                    <Text style={[vendorStyles.historyWeightText, h.isGreen ? vendorStyles.historyWeightGreen : vendorStyles.historyWeightRed]}>
                      {h.isGreen ? `+${h.weight.toFixed(2)}` : `${h.weight.toFixed(2)}`} kg
                    </Text>
                  </View>
                ))
              )}
            </ScrollView>

            <TouchableOpacity 
              style={vendorStyles.clearHistoryBtn} 
              onPress={handleClearFruitStockHistory}
            >
              <Feather name="trash-2" size={15} color={STATUS_COLORS.FAILED} />
              <Text style={[vendorStyles.clearHistoryBtnText, { color: STATUS_COLORS.FAILED }]}>Clear Stock Logs</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[vendorStyles.cancelBtn, { height: 44, marginTop: 8 }]} 
              onPress={() => setIsHistoryModalOpen(false)}
            >
              <Text style={vendorStyles.cancelBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── ADD FRUIT MODAL ── */}
      <Modal visible={isAddModalOpen} transparent animationType="slide" onRequestClose={() => setIsAddModalOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 20 }}>
            <Text style={{ fontSize: 18, fontWeight: '800', color: '#0F172A', marginBottom: 12 }}>Add Fruit</Text>

            <Text style={vendorStyles.fieldLabelSmall}>Fruit Name:</Text>
            <TextInput
              style={vendorStyles.modalTextInput}
              placeholder="e.g. Watermelon"
              placeholderTextColor="#94A3B8"
              value={newFruitName}
              onChangeText={setNewFruitName}
            />

            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={vendorStyles.fieldLabelSmall}>Price / kg (₱):</Text>
                <TextInput
                  style={vendorStyles.modalTextInput}
                  keyboardType="numeric"
                  placeholder="100"
                  placeholderTextColor="#94A3B8"
                  value={newPricePerKg}
                  onChangeText={setNewPricePerKg}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={vendorStyles.fieldLabelSmall}>Stock (kg):</Text>
                <TextInput
                  style={vendorStyles.modalTextInput}
                  keyboardType="numeric"
                  placeholder="50"
                  placeholderTextColor="#94A3B8"
                  value={newStockKg}
                  onChangeText={setNewStockKg}
                />
              </View>
            </View>

            <Text style={vendorStyles.fieldLabelSmall}>Supplier Name:</Text>
            <TextInput
              style={vendorStyles.modalTextInput}
              placeholder="e.g. Bulacan Fruit Trading"
              placeholderTextColor="#94A3B8"
              value={newSupplierName}
              onChangeText={setNewSupplierName}
            />

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
              <TouchableOpacity style={[vendorStyles.cancelBtn, { height: 42 }]} onPress={() => setIsAddModalOpen(false)}>
                <Text style={vendorStyles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[vendorStyles.saveChangesBtn, { height: 42 }]} onPress={handleCreateNewFruit}>
                <Text style={vendorStyles.saveChangesBtnText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── QR SCANNER ── */}
      {consumerScreen === 'scanner' && (
        <View style={StyleSheet.absoluteFillObject}>
          {!permission?.granted ? (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff', padding: 20 }}>
              <Text style={{ marginBottom: 12 }}>Camera permission needed.</Text>
              <TouchableOpacity style={vendorStyles.addFruitBtn} onPress={requestPermission}>
                <Text style={vendorStyles.addFruitBtnText}>Grant Permission</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={baseStyles.cameraContainer}>
              <CameraView
                style={baseStyles.camera}
                facing="back"
                onBarcodeScanned={scanned ? undefined : handleBarcodeScanned}
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              >
                <View style={baseStyles.overlay}>
                  <View style={baseStyles.scanBox}>
                    <View style={[baseStyles.corner, baseStyles.tl]} />
                    <View style={[baseStyles.corner, baseStyles.tr]} />
                    <View style={[baseStyles.corner, baseStyles.bl]} />
                    <View style={[baseStyles.corner, baseStyles.br]} />
                  </View>
                  <Text style={baseStyles.scanHint}>Point camera at the Kiosk QR</Text>
                </View>
              </CameraView>
              
              <TouchableOpacity
                style={{ position: 'absolute', top: 40, left: 20, backgroundColor: 'rgba(0,0,0,0.6)', padding: 10, borderRadius: 20 }}
                onPress={() => { setConsumerScreen('basket'); setScanned(false); }}
              >
                <Feather name="arrow-left" size={20} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}
    </SafeAreaView>
  );
}

const inlineStyles = StyleSheet.create({
  archiveSwitchWrap: {
    flexDirection: 'row',
    backgroundColor: '#E2E8F0',
    borderRadius: 8,
    padding: 3,
    marginBottom: 10,
  },
  archiveSwitchBtn: {
    flex: 1,
    paddingVertical: 7,
    alignItems: 'center',
    borderRadius: 6,
  },
  archiveSwitchBtnActive: {
    backgroundColor: '#FFFFFF',
    elevation: 1,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 2,
  },
  archiveSwitchText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
  },
  archiveSwitchTextActive: {
    color: STATUS_COLORS.PRIMARY_GREEN,
    fontWeight: '800',
  },
});