import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export default function PasswordStrengthMeter({ password }) {
  if (!password) return null;

  // Criteria calculations
  const hasLength = password.length >= 8;
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasSpecial = /[!@#$%^&*(),.?":{}|<>_]/.test(password);

  const criteriaMet = [hasLength, hasUpper, hasLower, hasNumber, hasSpecial].filter(Boolean).length;

  let label = "Very Weak";
  let color = "#DC2626"; // Red
  let barWidth = "20%";

  if (criteriaMet === 5) {
    label = "Strong";
    color = "#16A34A"; // Green
    barWidth = "100%";
  } else if (criteriaMet >= 3) {
    label = "Medium";
    color = "#F59E0B"; // Amber / Orange
    barWidth = "60%";
  } else if (criteriaMet >= 2) {
    label = "Weak";
    color = "#EF4444"; // Light Red
    barWidth = "40%";
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Password Strength:</Text>
        <Text style={[styles.label, { color }]}>{label}</Text>
      </View>

      {/* Progress Bar */}
      <View style={styles.barBackground}>
        <View style={[styles.barFill, { width: barWidth, backgroundColor: color }]} />
      </View>

      {/* Rule Checks Checklist */}
      <View style={styles.rulesContainer}>
        <Text style={[styles.ruleText, hasLength ? styles.valid : styles.invalid]}>
          {hasLength ? "✓" : "○"} 8+ characters
        </Text>
        <Text style={[styles.ruleText, hasUpper && hasLower ? styles.valid : styles.invalid]}>
          {hasUpper && hasLower ? "✓" : "○"} Upper & lowercase
        </Text>
        <Text style={[styles.ruleText, hasNumber && hasSpecial ? styles.valid : styles.invalid]}>
          {hasNumber && hasSpecial ? "✓" : "○"} Number & symbol (!@#$_)
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: 6, marginBottom: 12 },
  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  title: { fontSize: 12, color: '#6B7280' },
  label: { fontSize: 12, fontWeight: '700' },
  barBackground: { height: 6, backgroundColor: '#E5E7EB', borderRadius: 3, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 3 },
  rulesContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  ruleText: { fontSize: 11 },
  valid: { color: '#16A34A', fontWeight: '600' },
  invalid: { color: '#9CA3AF' }
});