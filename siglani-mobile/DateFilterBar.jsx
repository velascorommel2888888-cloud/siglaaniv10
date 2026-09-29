import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { STATUS_COLORS } from './themeColors';

export default function DateFilterBar({ selectedPreset, onSelectPreset }) {
  const filters = [
    { label: 'All', value: 'all' },
    { label: 'Today', value: 'today' },
    { label: '7 Days', value: 'week' },
    { label: '30 Days', value: 'month' },
  ];

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Filter History:</Text>
      <View style={styles.row}>
        {filters.map((f) => {
          const active = selectedPreset === f.value;
          return (
            <TouchableOpacity
              key={f.value}
              onPress={() => onSelectPreset(f.value)}
              style={[
                styles.chip,
                active ? styles.chipActive : styles.chipInactive,
              ]}
              activeOpacity={0.7}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {f.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 16, paddingVertical: 10 },
  title: { fontSize: 12, fontWeight: '700', color: STATUS_COLORS.TEXT_MUTED, marginBottom: 6 },
  row: { flexDirection: 'row', gap: 8 },
  chip: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
  },
  chipInactive: { backgroundColor: '#F1F5F9', borderColor: '#CBD5E1' },
  chipActive: {
    backgroundColor: STATUS_COLORS.SUCCESS,
    borderColor: STATUS_COLORS.SUCCESS,
  },
  chipText: { fontSize: 13, color: '#334155', fontWeight: '500' },
  chipTextActive: { color: '#FFFFFF', fontWeight: '700' },
});