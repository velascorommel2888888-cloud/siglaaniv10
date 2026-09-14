import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  FlatList,
  Image,
  Alert,
  ActivityIndicator,
  StatusBar,
  TextInput,
  ScrollView,
  Modal
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BASE_URL } from './config';

const STORAGE_RECEIPTS_KEY = '@siglaani_receipts';
const STORAGE_INSPECTIONS_KEY = '@siglaani_inspections';

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
  const [role, setRole] = useState('consumer');
  const [screen, setScreen] = useState('basket');
  const [activeTab, setActiveTab] = useState('receipts');
  const [vendorTab, setVendorTab] = useState('inventory');
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [loading, setLoading] = useState(false);
  const [receipts, setReceipts] = useState([]);
  const [inspections, setInspections] = useState([]);
  const [expandedTxn, setExpandedTxn] = useState(null);

  // Vendor Portal State
  const [inventory, setInventory] = useState([]);
  const [editingData, setEditingData] = useState({});
  const [refreshingInv, setRefreshingInv] = useState(false);

  // Analytics State
  const [serverHistory, setServerHistory] = useState([]);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);

  // Add Item Modal State
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newFruitName, setNewFruitName] = useState('');
  const [newStockKg, setNewStockKg] = useState('50');
  const [newPricePerKg, setNewPricePerKg] = useState('120');
  const [newSupplierName, setNewSupplierName] = useState('');
  const [newSupplierContact, setNewSupplierContact] = useState('');
  const [addingItem, setAddingItem] = useState(false);

  useEffect(() => {
    loadLocalData();
  }, []);

  const loadLocalData = async () => {
    try {
      const recJson = await AsyncStorage.getItem(STORAGE_RECEIPTS_KEY);
      const inspJson = await AsyncStorage.getItem(STORAGE_INSPECTIONS_KEY);
      if (recJson) {
        const parsed = JSON.parse(recJson);
        setReceipts(parsed);
        checkFruitSpoilageOnLaunch(parsed);
      }
      if (inspJson) setInspections(JSON.parse(inspJson));
    } catch (e) {
      console.warn('Failed to load local storage data:', e);
    }
  };

  const fetchVendorInventory = useCallback(async () => {
    setRefreshingInv(true);
    try {
      const res = await fetch(`${BASE_URL}/api/inventory`);
      if (res.ok) {
        const data = await res.json();
        setInventory(data);
        const map = {};
        data.forEach(item => {
          map[item.fruit_type] = {
            stock: String(item.stock_count != null ? item.stock_count : (item.stock_kg || 50)),
            price: String(item.price_per_kg || item.unit_price || 100),
            supplier: item.supplier_name || 'Valenzuela Local Market',
            contact: item.supplier_contact || 'N/A'
          };
        });
        setEditingData(map);
      }
    } catch (err) {
      console.warn('Could not fetch inventory:', err);
    } finally {
      setRefreshingInv(false);
    }
  }, []);

  const fetchServerAnalytics = useCallback(async () => {
    setLoadingAnalytics(true);
    try {
      const res = await fetch(`${BASE_URL}/api/history?limit=200`);
      if (res.ok) {
        const data = await res.json();
        setServerHistory(Array.isArray(data) ? data : (data.history || []));
      }
    } catch (err) {
      console.warn('Could not fetch analytics history:', err);
    } finally {
      setLoadingAnalytics(false);
    }
  }, []);

  useEffect(() => {
    if (role === 'vendor') {
      fetchVendorInventory();
      if (vendorTab === 'analytics') {
        fetchServerAnalytics();
      }
    }
  }, [role, vendorTab, fetchVendorInventory, fetchServerAnalytics]);

  const handleUpdateItem = async (fruitType) => {
    const current = editingData[fruitType] || {};
    const newRate = parseFloat(current.price);
    const newStock = parseFloat(current.stock);

    if (isNaN(newRate) || newRate <= 0) {
      Alert.alert('Maling Halaga', 'Mangyaring maglagay ng tamang presyo kada kilo.');
      return;
    }
    if (isNaN(newStock) || newStock < 0) {
      Alert.alert('Maling Stock', 'Mangyaring maglagay ng tamang kilo ng stock.');
      return;
    }

    try {
      const res = await fetch(`${BASE_URL}/api/inventory/${encodeURIComponent(fruitType)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          price_per_kg: newRate,
          stock_kg: newStock,
          stock_count: newStock,
          supplier_name: current.supplier,
          supplier_contact: current.contact
        })
      });
      if (res.ok) {
        Alert.alert('Na-update!', `Na-save ang stock (${newStock}kg), presyo (₱${newRate}/kg), at supplier info para sa ${fruitType}.`);
        fetchVendorInventory();
      } else {
        throw new Error('Failed to update on server.');
      }
    } catch (err) {
      Alert.alert('Error', err.message || 'Hindi ma-update ang data sa server.');
    }
  };

  const handleDeleteInventoryItem = (fruitType) => {
    Alert.alert(
      'Burahin ang Prutas?',
      `Sigurado ka bang nais mong tanggalin ang "${fruitType}" mula sa imbentaryo at listahan ng kiosk?`,
      [
        { text: 'Kanselahin', style: 'cancel' },
        {
          text: 'Burahin',
          style: 'destructive',
          onPress: async () => {
            try {
              const res = await fetch(`${BASE_URL}/api/inventory/${encodeURIComponent(fruitType)}`, {
                method: 'DELETE'
              });
              if (res.ok) {
                Alert.alert('Nabura', `Matagumpay na natanggal ang ${fruitType}.`);
                fetchVendorInventory();
              } else {
                throw new Error('Nabigong burahin sa backend.');
              }
            } catch (err) {
              Alert.alert('Error', err.message || 'May problema sa koneksyon.');
            }
          }
        }
      ]
    );
  };

  const handleCreateNewFruit = async () => {
    if (!newFruitName.trim()) {
      Alert.alert('Kulang na Datos', 'Ilagay ang pangalan ng prutas.');
      return;
    }

    setAddingItem(true);
    try {
      const res = await fetch(`${BASE_URL}/api/inventory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fruit_type: newFruitName.trim(),
          stock_kg: parseFloat(newStockKg) || 50,
          price_per_kg: parseFloat(newPricePerKg) || 120,
          supplier_name: newSupplierName.trim() || 'Valenzuela Local Market',
          supplier_contact: newSupplierContact.trim() || 'N/A'
        })
      });

      if (res.ok) {
        Alert.alert('Tagumpay', `Naidagdag ang ${newFruitName} sa imbentaryo.`);
        setIsAddModalOpen(false);
        setNewFruitName('');
        setNewStockKg('50');
        setNewPricePerKg('120');
        setNewSupplierName('');
        setNewSupplierContact('');
        fetchVendorInventory();
      } else {
        throw new Error('Hindi nai-save sa backend.');
      }
    } catch (err) {
      Alert.alert('Error', err.message || 'May problema sa koneksyon.');
    } finally {
      setAddingItem(false);
    }
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
        if (!res.ok) throw new Error(`Receipt ${txnId} not found on server.`);
        const receiptData = await res.json();

        const updatedReceipts = [receiptData, ...receipts.filter(r => r.transaction_id !== txnId)];
        setReceipts(updatedReceipts);
        await AsyncStorage.setItem(STORAGE_RECEIPTS_KEY, JSON.stringify(updatedReceipts));

        Alert.alert(
          'Receipt Synced', 
          `Batch ng ${receiptData.total_items || receiptData.items?.length || 1} prutas ay naidagdag sa Fresh Basket!`, 
          [
            {
              text: 'View Basket',
              onPress: () => {
                setActiveTab('receipts');
                setScreen('basket');
                setScanned(false);
              }
            }
          ]
        );
      } else {
        let cleanScanId = rawData.replace('siglaani://inspection/', '').trim();
        
        if (cleanScanId.startsWith('TXN_')) {
          const res = await fetch(`${BASE_URL}/api/receipt/${cleanScanId}`);
          if (!res.ok) throw new Error(`Scan ${cleanScanId} not found.`);
          const receiptData = await res.json();
          const updatedReceipts = [receiptData, ...receipts.filter(r => r.transaction_id !== cleanScanId)];
          setReceipts(updatedReceipts);
          await AsyncStorage.setItem(STORAGE_RECEIPTS_KEY, JSON.stringify(updatedReceipts));
          Alert.alert('Synced', 'Batch loaded successfully!');
          setActiveTab('receipts');
          setScreen('basket');
          setScanned(false);
          return;
        }

        const res = await fetch(`${BASE_URL}/api/scan/${cleanScanId}`);
        if (!res.ok) throw new Error(`Inspection scan #${cleanScanId} not found on server.`);
        const scanData = await res.json();

        const updatedInspections = [scanData, ...inspections.filter(i => (i.scan_id || i.id) !== (scanData.scan_id || scanData.id))];
        setInspections(updatedInspections);
        await AsyncStorage.setItem(STORAGE_INSPECTIONS_KEY, JSON.stringify(updatedInspections));

        Alert.alert('Inspection Logged', `Nai-save ang scan para sa ${scanData.fruit_type || scanData.fruit || 'Fruit'}!`, [
          {
            text: 'View Inspections',
            onPress: () => {
              setActiveTab('inspections');
              setScreen('basket');
              setScanned(false);
            }
          }
        ]);
      }
    } catch (err) {
      Alert.alert('Scan Failed', err.message || 'Could not fetch data from kiosk.', [
        { text: 'Try Again', onPress: () => setScanned(false) }
      ]);
    } finally {
      setLoading(false);
    }
  };

  const toggleExpand = (txnId) => {
    setExpandedTxn(prev => (prev === txnId ? null : txnId));
  };

  const confirmDeleteReceipt = (txnId) => {
    Alert.alert(
      'Burahin ang Resibo?',
      `Nais mo bang tanggalin ang resibong ${txnId} mula sa iyong My Fresh Basket?`,
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
      'Nais mo bang tanggalin ang inspection result na ito mula sa history?',
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

  // Analytics Computation
  const totalScans = serverHistory.length;
  const fruitCounts = {};
  let ripeCount = 0;

  serverHistory.forEach(item => {
    const name = item.fruit || item.fruit_type || 'Unknown';
    fruitCounts[name] = (fruitCounts[name] || 0) + 1;

    const condition = (item.condition || item.condition_label || item.status || '').toLowerCase();
    if (condition.includes('hinog') || condition.includes('ripe')) {
      ripeCount++;
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

  const renderReceiptCard = ({ item }) => {
    const isExpanded = expandedTxn === item.transaction_id;
    const itemList = item.items || [];

    return (
      <View style={styles.card}>
        <TouchableOpacity 
          style={styles.cardHeader} 
          onPress={() => toggleExpand(item.transaction_id)} 
          onLongPress={() => confirmDeleteReceipt(item.transaction_id)}
          delayLongPress={500}
          activeOpacity={0.7}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.vendorName}>{item.vendor_name || 'Sigla Ani Kiosk'}</Text>
            <Text style={styles.dateText}>{item.purchased_at ? new Date(item.purchased_at).toLocaleString() : 'Recent Purchase'}</Text>
            <Text style={styles.codeText}>{item.transaction_id}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <View style={styles.badgeWrap}>
              <Text style={styles.badgeText}>{itemList.length || item.total_items || 1} Items</Text>
            </View>
            <Text style={styles.expandLabel}>{isExpanded ? 'Hide ▲' : 'View Fruits ▼'}</Text>
          </View>
        </TouchableOpacity>

        {isExpanded && (
          <View style={styles.expandedContent}>
            {itemList.map((fruit, idx) => {
              const imgUrl = fruit.image_url ? `${BASE_URL}${fruit.image_url}` : null;
              const isRotten = (fruit.status || '').toLowerCase().includes('bulok') || (fruit.status || '').toLowerCase().includes('rotten');
              const shelfLife = getShelfLifeInfo(fruit.status, item.purchased_at);

              return (
                <View key={idx} style={styles.fruitRow}>
                  {imgUrl ? (
                    <Image source={{ uri: imgUrl }} style={styles.fruitImage} />
                  ) : (
                    <View style={[styles.fruitImage, { backgroundColor: '#e2e8f0' }]} />
                  )}
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={styles.fruitName}>{fruit.fruit_type}</Text>
                      <View style={[styles.statusPill, { backgroundColor: isRotten ? '#fee2e2' : '#dcfce7' }]}>
                        <Text style={[styles.statusPillText, { color: isRotten ? '#ef4444' : '#16a34a' }]}>{fruit.status}</Text>
                      </View>
                    </View>
                    <Text style={styles.scientificName}>{fruit.scientific || 'SIGLA ANI AI'}</Text>
                    
                    <View style={[styles.shelfLifeBadge, { backgroundColor: shelfLife.isExpiringSoon ? '#fff1f2' : '#f0fdf4' }]}>
                      <Text style={[styles.shelfLifeText, { color: shelfLife.isExpiringSoon ? '#e11d48' : '#16a34a' }]}>
                        ⏳ {shelfLife.statusText}
                      </Text>
                    </View>

                    <Text style={styles.confidenceText}>Confidence: {Math.round(fruit.confidence || 90)}%</Text>
                    {fruit.recommendation ? (
                      <Text style={styles.recoText}>"{fruit.recommendation}"</Text>
                    ) : null}
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </View>
    );
  };

  const renderInspectionCard = ({ item }) => {
    const imgUrl = item.image_url ? `${BASE_URL}${item.image_url}` : null;
    const isRotten = (item.status || '').toLowerCase().includes('bulok') || (item.status || '').toLowerCase().includes('rotten');
    const itemId = item.scan_id || item.id;

    return (
      <View style={styles.card}>
        <TouchableOpacity 
          onLongPress={() => confirmDeleteInspection(itemId)}
          delayLongPress={500}
          activeOpacity={0.8}
        >
          <View style={{ flexDirection: 'row', padding: 14 }}>
            {imgUrl ? (
              <Image source={{ uri: imgUrl }} style={styles.fruitImageLarge} />
            ) : (
              <View style={[styles.fruitImageLarge, { backgroundColor: '#e2e8f0' }]} />
            )}
            <View style={{ flex: 1, marginLeft: 14, justifyContent: 'center' }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={styles.fruitName}>{item.fruit_type || item.fruit}</Text>
                <View style={[styles.statusPill, { backgroundColor: isRotten ? '#fee2e2' : '#dcfce7' }]}>
                  <Text style={[styles.statusPillText, { color: isRotten ? '#ef4444' : '#16a34a' }]}>{item.status}</Text>
                </View>
              </View>
              <Text style={styles.scientificName}>{item.scientific || 'SIGLA ANI AI'}</Text>
              <Text style={styles.confidenceText}>Confidence: {Math.round(item.confidence || 85)}%</Text>
              <Text style={styles.dateText}>{item.timestamp ? new Date(item.timestamp).toLocaleString() : 'Inspected'}</Text>
            </View>
          </View>
          {item.recommendation ? (
            <View style={styles.recoBox}>
              <Text style={styles.recoText}>"{item.recommendation}"</Text>
            </View>
          ) : null}
        </TouchableOpacity>
      </View>
    );
  };

  // Vendor Inventory Card with 3-Dot Options Button
  const renderInventoryItem = ({ item }) => {
    const data = editingData[item.fruit_type] || {};

    return (
      <View style={styles.card}>
        <View style={{ padding: 16 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <Text style={styles.vendorFruitTitle}>{item.fruit_type}</Text>
            
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {/* Editable Stock Input Wrap */}
              <View style={styles.stockInputWrap}>
                <TextInput
                  style={styles.stockInputField}
                  keyboardType="numeric"
                  value={data.stock || ''}
                  onChangeText={(text) => setEditingData(prev => ({
                    ...prev,
                    [item.fruit_type]: { ...prev[item.fruit_type], stock: text }
                  }))}
                  placeholder="50"
                />
                <Text style={styles.stockUnitLabel}>kg stock</Text>
              </View>

              {/* 3-Dot Options Action Button */}
              <TouchableOpacity 
                style={styles.moreOptionsBtn}
                onPress={() => handleDeleteInventoryItem(item.fruit_type)}
                activeOpacity={0.6}
              >
                <Text style={styles.moreOptionsIcon}>⋮</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Supplier Inputs */}
          <View style={styles.supplierBlock}>
            <Text style={styles.inputFieldLabel}>Supplier Name:</Text>
            <TextInput
              style={styles.textInputField}
              value={data.supplier || ''}
              onChangeText={(text) => setEditingData(prev => ({
                ...prev,
                [item.fruit_type]: { ...prev[item.fruit_type], supplier: text }
              }))}
              placeholder="e.g. Valenzuela Local Market"
            />

            <Text style={[styles.inputFieldLabel, { marginTop: 6 }]}>Supplier Contact:</Text>
            <TextInput
              style={styles.textInputField}
              value={data.contact || ''}
              onChangeText={(text) => setEditingData(prev => ({
                ...prev,
                [item.fruit_type]: { ...prev[item.fruit_type], contact: text }
              }))}
              placeholder="e.g. 0917-XXX-XXXX"
            />
          </View>

          {/* Price Edit Row */}
          <View style={styles.priceEditRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
              <Text style={styles.currencyPrefix}>₱</Text>
              <TextInput
                style={styles.priceInput}
                keyboardType="numeric"
                value={data.price || ''}
                onChangeText={(text) => setEditingData(prev => ({
                  ...prev,
                  [item.fruit_type]: { ...prev[item.fruit_type], price: text }
                }))}
                placeholder="0.00"
              />
              <Text style={styles.perKgLabel}>/ kg</Text>
            </View>

            <TouchableOpacity 
              style={styles.savePriceBtn}
              onPress={() => handleUpdateItem(item.fruit_type)}
            >
              <Text style={styles.savePriceBtnText}>Save All</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />
      
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>SIGLA ANI</Text>
          <Text style={styles.roleSubHeader}>
            {role === 'vendor' ? '🏪 Vendor / Admin Portal' : '🌱 Consumer Fresh Basket'}
          </Text>
        </View>
        
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity 
            style={[styles.roleSwitchBtn, role === 'vendor' && styles.roleSwitchBtnActive]}
            onPress={() => setRole(prev => (prev === 'consumer' ? 'vendor' : 'consumer'))}
          >
            <Text style={[styles.roleSwitchText, role === 'vendor' && styles.roleSwitchTextActive]}>
              {role === 'consumer' ? 'Vendor Mode' : 'Consumer Mode'}
            </Text>
          </TouchableOpacity>

          {role === 'consumer' && (
            <TouchableOpacity 
              style={styles.scanToggleBtn}
              onPress={() => {
                if (screen === 'scanner') {
                  setScreen('basket');
                  setScanned(false);
                } else {
                  setScreen('scanner');
                }
              }}
            >
              <Text style={styles.scanToggleText}>{screen === 'scanner' ? 'Back' : '📷 QR'}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* VENDOR VIEW */}
      {role === 'vendor' ? (
        <View style={styles.basketContainer}>
          <View style={styles.tabBar}>
            <TouchableOpacity
              style={[styles.tabBtn, vendorTab === 'inventory' && styles.tabBtnActive]}
              onPress={() => setVendorTab('inventory')}
            >
              <Text style={[styles.tabText, vendorTab === 'inventory' && styles.tabTextActive]}>
                Inventory ({inventory.length})
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.tabBtn, vendorTab === 'analytics' && styles.tabBtnActive]}
              onPress={() => setVendorTab('analytics')}
            >
              <Text style={[styles.tabText, vendorTab === 'analytics' && styles.tabTextActive]}>
                Kiosk Analytics & Status
              </Text>
            </TouchableOpacity>
          </View>

          {vendorTab === 'inventory' ? (
            <View style={{ flex: 1 }}>
              <View style={{ paddingHorizontal: 14, paddingTop: 10 }}>
                <TouchableOpacity 
                  style={styles.addNewFruitBtn}
                  onPress={() => setIsAddModalOpen(true)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.addNewFruitBtnText}>+ Add New Fruit / Stock</Text>
                </TouchableOpacity>
              </View>

              <FlatList
                data={inventory}
                keyExtractor={(item) => String(item.id || item.fruit_type)}
                renderItem={renderInventoryItem}
                contentContainerStyle={{ padding: 14 }}
                refreshing={refreshingInv}
                onRefresh={fetchVendorInventory}
                ListEmptyComponent={
                  <View style={styles.emptyWrap}>
                    <Text style={styles.emptyTitle}>Connecting to Kiosk Inventory...</Text>
                    <Text style={styles.emptySub}>Ensure your Flask server is running at {BASE_URL}.</Text>
                  </View>
                }
              />
            </View>
          ) : (
            <ScrollView contentContainerStyle={{ padding: 14 }}>
              {loadingAnalytics ? (
                <ActivityIndicator size="small" color="#1a6630" style={{ marginVertical: 20 }} />
              ) : (
                <>
                  {/* Metric Cards */}
                  <View style={[styles.analyticsCard, { borderLeftColor: '#22c55e' }]}>
                    <Text style={styles.analyticsMetricLabel}>KABUUAN NG NA-SCAN</Text>
                    <Text style={styles.analyticsMetricVal}>{totalScans}</Text>
                  </View>

                  <View style={[styles.analyticsCard, { borderLeftColor: '#eab308' }]}>
                    <Text style={styles.analyticsMetricLabel}>NANGUNGUNANG PRUTAS</Text>
                    <Text style={styles.analyticsMetricVal}>
                      {topFruit} {maxCount > 0 ? `(${maxCount})` : ''}
                    </Text>
                  </View>

                  <View style={[styles.analyticsCard, { borderLeftColor: '#3b82f6' }]}>
                    <Text style={styles.analyticsMetricLabel}>FRESHNESS RATE (HINOG)</Text>
                    <Text style={styles.analyticsMetricVal}>{freshnessRate}%</Text>
                  </View>

                  {/* Distribution Bar List */}
                  <View style={[styles.card, { padding: 16, marginTop: 4 }]}>
                    <Text style={styles.distributionTitle}>Distribusyon ng Bawat Prutas</Text>

                    {Object.keys(fruitCounts).length === 0 ? (
                      <Text style={{ color: '#888', fontSize: 13 }}>Wala pang mga na-scan na prutas.</Text>
                    ) : (
                      <View style={{ gap: 12, marginTop: 8 }}>
                        {Object.entries(fruitCounts).map(([fruit, count]) => {
                          const percentage = totalScans > 0 ? Math.round((count / totalScans) * 100) : 0;
                          return (
                            <View key={fruit} style={{ gap: 4 }}>
                              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                                <Text style={styles.distFruitName}>{fruit}</Text>
                                <Text style={styles.distFruitMeta}>{count} scans ({percentage}%)</Text>
                              </View>
                              <View style={styles.progressBarTrack}>
                                <View style={[styles.progressBarFill, { width: `${percentage}%` }]} />
                              </View>
                            </View>
                          );
                        })}
                      </View>
                    )}
                  </View>

                  {/* Kiosk Live Status Card */}
                  <View style={[styles.card, { padding: 16, marginTop: 12 }]}>
                    <Text style={styles.analyticsSectionTitle}>Kiosk Live Status</Text>
                    <View style={styles.statusRowItem}>
                      <Text style={styles.statusRowLabel}>Backend Endpoint:</Text>
                      <Text style={styles.statusRowVal}>{BASE_URL}</Text>
                    </View>
                    <View style={styles.statusRowItem}>
                      <Text style={styles.statusRowLabel}>Total Syncs:</Text>
                      <Text style={styles.statusRowVal}>{receipts.length} batches</Text>
                    </View>
                    <View style={styles.statusRowItem}>
                      <Text style={styles.statusRowLabel}>Inspection Count:</Text>
                      <Text style={styles.statusRowVal}>{inspections.length} logs</Text>
                    </View>
                    <View style={[styles.statusRowItem, { borderBottomWidth: 0 }]}>
                      <Text style={styles.statusRowLabel}>Active Stock in Kiosk:</Text>
                      <Text style={styles.statusRowVal}>
                        {inventory.reduce((acc, curr) => acc + (parseFloat(editingData[curr.fruit_type]?.stock) || curr.stock_count || 0), 0).toFixed(0)} kg
                      </Text>
                    </View>
                  </View>
                </>
              )}
            </ScrollView>
          )}

          {/* ADD NEW FRUIT MODAL */}
          <Modal
            visible={isAddModalOpen}
            transparent={true}
            animationType="slide"
            onRequestClose={() => setIsAddModalOpen(false)}
          >
            <View style={styles.modalOverlay}>
              <View style={styles.modalCard}>
                <Text style={styles.modalHeaderTitle}>Add Fruit to Inventory</Text>
                
                <Text style={styles.modalInputLabel}>Fruit Name:</Text>
                <TextInput
                  style={styles.modalTextInput}
                  placeholder="e.g. Mango, Papaya, Grapes"
                  value={newFruitName}
                  onChangeText={setNewFruitName}
                />

                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.modalInputLabel}>Price / kg (₱):</Text>
                    <TextInput
                      style={styles.modalTextInput}
                      keyboardType="numeric"
                      placeholder="120"
                      value={newPricePerKg}
                      onChangeText={setNewPricePerKg}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.modalInputLabel}>Stock (kg):</Text>
                    <TextInput
                      style={styles.modalTextInput}
                      keyboardType="numeric"
                      placeholder="50"
                      value={newStockKg}
                      onChangeText={setNewStockKg}
                    />
                  </View>
                </View>

                <Text style={styles.modalInputLabel}>Supplier Name:</Text>
                <TextInput
                  style={styles.modalTextInput}
                  placeholder="e.g. Bulacan Fruit Trading"
                  value={newSupplierName}
                  onChangeText={setNewSupplierName}
                />

                <Text style={styles.modalInputLabel}>Supplier Contact:</Text>
                <TextInput
                  style={styles.modalTextInput}
                  placeholder="e.g. 0917-111-2222"
                  value={newSupplierContact}
                  onChangeText={setNewSupplierContact}
                />

                <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
                  <TouchableOpacity 
                    style={styles.modalCancelBtn}
                    onPress={() => setIsAddModalOpen(false)}
                  >
                    <Text style={styles.modalCancelBtnText}>Cancel</Text>
                  </TouchableOpacity>

                  <TouchableOpacity 
                    style={styles.modalSubmitBtn}
                    onPress={handleCreateNewFruit}
                    disabled={addingItem}
                  >
                    {addingItem ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <Text style={styles.modalSubmitBtnText}>Add Fruit</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>
        </View>
      ) : (
        /* CONSUMER VIEW */
        screen === 'scanner' ? (
          <View style={styles.scannerContainer}>
            {!permission?.granted ? (
              <View style={styles.centerWrap}>
                <Text style={{ textAlign: 'center', marginBottom: 12 }}>Camera permission needed to scan receipt QR.</Text>
                <TouchableOpacity style={styles.actionBtn} onPress={requestPermission}>
                  <Text style={styles.actionBtnText}>Grant Camera Permission</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <CameraView
                  style={StyleSheet.absoluteFillObject}
                  facing="back"
                  onBarcodeScanned={scanned ? undefined : handleBarcodeScanned}
                  barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                />
                <View style={styles.scanOverlay}>
                  <View style={styles.scanTargetBox} />
                  <Text style={styles.scanHint}>Point camera at the Kiosk QR</Text>
                </View>
                {loading && (
                  <View style={styles.loadingOverlay}>
                    <ActivityIndicator size="large" color="#7ee84a" />
                    <Text style={{ color: '#fff', marginTop: 10, fontWeight: '700' }}>Fetching receipt details...</Text>
                  </View>
                )}
              </>
            )}
          </View>
        ) : (
          <View style={styles.basketContainer}>
            <View style={styles.tabBar}>
              <TouchableOpacity
                style={[styles.tabBtn, activeTab === 'receipts' && styles.tabBtnActive]}
                onPress={() => setActiveTab('receipts')}
              >
                <Text style={[styles.tabText, activeTab === 'receipts' && styles.tabTextActive]}>
                  My Receipts ({receipts.length})
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.tabBtn, activeTab === 'inspections' && styles.tabBtnActive]}
                onPress={() => setActiveTab('inspections')}
              >
                <Text style={[styles.tabText, activeTab === 'inspections' && styles.tabTextActive]}>
                  Inspections ({inspections.length})
                </Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.hintBar}>💡 I-hold (long-press) ang card para burahin</Text>

            {activeTab === 'receipts' ? (
              <FlatList
                data={receipts}
                keyExtractor={(item) => item.transaction_id}
                renderItem={renderReceiptCard}
                contentContainerStyle={{ padding: 14 }}
                ListEmptyComponent={
                  <View style={styles.emptyWrap}>
                    <Text style={styles.emptyTitle}>No digital receipts yet.</Text>
                    <Text style={styles.emptySub}>Scan the receipt QR on the kiosk after checking out to sync your basket.</Text>
                  </View>
                }
              />
            ) : (
              <FlatList
                data={inspections}
                keyExtractor={(item, idx) => String(item.scan_id || item.id || idx)}
                renderItem={renderInspectionCard}
                contentContainerStyle={{ padding: 14 }}
                ListEmptyComponent={
                  <View style={styles.emptyWrap}>
                    <Text style={styles.emptyTitle}>No inspection logs saved.</Text>
                    <Text style={styles.emptySub}>Scan an inspection QR on the kiosk result screen to log fruit freshness without buying.</Text>
                  </View>
                }
              />
            )}
          </View>
        )
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f4f6f0' },
  header: {
    paddingVertical: 12,
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderColor: '#e5e7eb'
  },
  headerTitle: { fontSize: 18, fontWeight: '800', color: '#1a6630', letterSpacing: 0.5 },
  roleSubHeader: { fontSize: 11, color: '#666', fontWeight: '600', marginTop: 1 },
  roleSwitchBtn: {
    backgroundColor: '#f1f8e9',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#dcfce7'
  },
  roleSwitchBtnActive: {
    backgroundColor: '#0b1f0d',
    borderColor: '#0b1f0d'
  },
  roleSwitchText: { fontSize: 11, fontWeight: '700', color: '#1a6630' },
  roleSwitchTextActive: { color: '#7ee84a' },
  scanToggleBtn: {
    backgroundColor: '#1a6630',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16
  },
  scanToggleText: { color: '#fff', fontWeight: '800', fontSize: 11 },
  basketContainer: { flex: 1 },
  tabBar: {
    flexDirection: 'row',
    padding: 10,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderColor: '#e5e7eb'
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 10
  },
  tabBtnActive: { backgroundColor: '#1a6630' },
  tabText: { fontSize: 13, fontWeight: '700', color: '#666' },
  tabTextActive: { color: '#fff' },
  hintBar: { textAlign: 'center', fontSize: 11, color: '#888', marginTop: 6 },
  
  // Add Fruit Button
  addNewFruitBtn: {
    backgroundColor: '#1a6630',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 6
  },
  addNewFruitBtnText: { color: '#fff', fontWeight: '800', fontSize: 14 },

  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    overflow: 'hidden'
  },
  cardHeader: {
    flexDirection: 'row',
    padding: 14,
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  vendorName: { fontSize: 15, fontWeight: '800', color: '#0b1f0d' },
  dateText: { fontSize: 12, color: '#888', marginTop: 2 },
  codeText: { fontSize: 11, fontFamily: 'monospace', color: '#999', marginTop: 2 },
  badgeWrap: {
    backgroundColor: '#f1f8e9',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12
  },
  badgeText: { fontSize: 12, fontWeight: '800', color: '#1a6630' },
  expandLabel: { fontSize: 11, color: '#666', marginTop: 4, fontWeight: '600' },
  expandedContent: {
    backgroundColor: '#fafafa',
    borderTopWidth: 1,
    borderColor: '#f0f0f0',
    padding: 12
  },
  fruitRow: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    padding: 10,
    borderRadius: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#f0f0f0',
    alignItems: 'center'
  },
  fruitImage: { width: 56, height: 56, borderRadius: 8, backgroundColor: '#051307' },
  fruitImageLarge: { width: 72, height: 72, borderRadius: 10, backgroundColor: '#051307' },
  fruitName: { fontSize: 15, fontWeight: '800', color: '#111' },
  scientificName: { fontSize: 12, fontStyle: 'italic', color: '#777', marginTop: 1 },
  shelfLifeBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    marginTop: 4
  },
  shelfLifeText: { fontSize: 11, fontWeight: '700' },
  statusPill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  statusPillText: { fontSize: 11, fontWeight: '800' },
  confidenceText: { fontSize: 12, color: '#555', marginTop: 2 },
  recoText: { fontSize: 12, color: '#444', fontStyle: 'italic', marginTop: 4 },
  recoBox: { padding: 12, backgroundColor: '#f9fafb', borderTopWidth: 1, borderColor: '#f0f0f0' },
  
  // Vendor Inventory Styles
  vendorFruitTitle: { fontSize: 18, fontWeight: '800', color: '#0b1f0d' },
  stockInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f1f8e9',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#dcfce7'
  },
  stockInputField: {
    fontSize: 13,
    fontWeight: '800',
    color: '#1a6630',
    padding: 0,
    minWidth: 28,
    textAlign: 'center'
  },
  stockUnitLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: '#1a6630',
    marginLeft: 3
  },
  moreOptionsBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#f1f5f9',
    justifyContent: 'center',
    alignItems: 'center'
  },
  moreOptionsIcon: {
    fontSize: 16,
    fontWeight: '900',
    color: '#475569',
    lineHeight: 18
  },
  supplierBlock: {
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    padding: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0'
  },
  inputFieldLabel: { fontSize: 11, fontWeight: '700', color: '#475569' },
  textInputField: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 13,
    color: '#0f172a',
    marginTop: 2
  },
  priceEditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f9fafb',
    borderRadius: 10,
    padding: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb'
  },
  currencyPrefix: { fontSize: 16, fontWeight: '800', color: '#1a6630', marginRight: 4 },
  priceInput: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    fontSize: 16,
    fontWeight: '800',
    color: '#0b1f0d',
    width: 80,
    textAlign: 'center'
  },
  perKgLabel: { fontSize: 14, fontWeight: '700', color: '#666', marginLeft: 6 },
  savePriceBtn: {
    backgroundColor: '#1a6630',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8
  },
  savePriceBtnText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  
  // Analytics Styles
  analyticsCard: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    borderLeftWidth: 5,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    marginBottom: 10
  },
  analyticsMetricLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#64748b',
    textTransform: 'uppercase'
  },
  analyticsMetricVal: {
    fontSize: 24,
    fontWeight: '900',
    color: '#0b1f0d',
    marginTop: 4
  },
  distributionTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0b1f0d',
    marginBottom: 10
  },
  distFruitName: { fontSize: 13, fontWeight: '700', color: '#111' },
  distFruitMeta: { fontSize: 12, color: '#666' },
  progressBarTrack: {
    width: '100%',
    height: 7,
    backgroundColor: '#f1f5f9',
    borderRadius: 4,
    overflow: 'hidden'
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#1a6630',
    borderRadius: 4
  },

  analyticsSectionTitle: { fontSize: 15, fontWeight: '800', color: '#0b1f0d', marginBottom: 12 },
  statusRowItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderColor: '#f0f0f0'
  },
  statusRowLabel: { fontSize: 13, color: '#666', fontWeight: '600' },
  statusRowVal: { fontSize: 13, color: '#111', fontWeight: '800' },

  emptyWrap: { padding: 30, alignItems: 'center', marginTop: 40 },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: '#444', marginBottom: 6 },
  emptySub: { fontSize: 13, color: '#777', textAlign: 'center', lineHeight: 18 },
  scannerContainer: { flex: 1, backgroundColor: '#000' },
  scanOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center'
  },
  scanTargetBox: {
    width: 240,
    height: 240,
    borderWidth: 2,
    borderColor: '#7ee84a',
    borderRadius: 16,
    backgroundColor: 'transparent'
  },
  scanHint: { color: '#fff', marginTop: 20, fontSize: 14, fontWeight: '700' },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center'
  },
  centerWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  actionBtn: { backgroundColor: '#1a6630', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8 },
  actionBtnText: { color: '#fff', fontWeight: '800' },

  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 20
  },
  modalCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    elevation: 5
  },
  modalHeaderTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0b1f0d',
    marginBottom: 12
  },
  modalInputLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
    marginTop: 8
  },
  modalTextInput: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 14,
    color: '#0f172a',
    marginTop: 4
  },
  modalCancelBtn: {
    flex: 1,
    backgroundColor: '#f1f5f9',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center'
  },
  modalCancelBtnText: { color: '#475569', fontWeight: '700' },
  modalSubmitBtn: {
    flex: 1,
    backgroundColor: '#1a6630',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center'
  },
  modalSubmitBtnText: { color: '#fff', fontWeight: '800' }
});