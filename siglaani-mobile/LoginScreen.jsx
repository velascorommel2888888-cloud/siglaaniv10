import React, { useState, useEffect } from 'react';
import {
  Text,
  View,
  TouchableOpacity,
  TextInput,
  ScrollView,
  StatusBar,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
  TouchableWithoutFeedback
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather, Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BASE_URL } from './config';
import { loginStyles } from './loginStyles';

const STORAGE_AUTH_USER_KEY = '@siglaani_auth_user';

export default function LoginScreen({ onLoginSuccess }) {
  const [authMode, setAuthMode] = useState('login'); // 'login' or 'register'
  const [selectedRole, setSelectedRole] = useState('vendor'); // 'vendor' or 'consumer'
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  useEffect(() => {
    const showListener = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => setKeyboardVisible(true)
    );
    const hideListener = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setKeyboardVisible(false)
    );

    return () => {
      showListener.remove();
      hideListener.remove();
    };
  }, []);

  const handleAuthAction = async () => {
    const cleanUser = username.trim();
    const cleanPass = password.trim();

    if (!cleanUser || !cleanPass) {
      Alert.alert('Required Fields', 'Please enter your username and password.');
      return;
    }

    if (authMode === 'register' && selectedRole === 'vendor' && !fullName.trim()) {
      Alert.alert('Required Fields', 'Please enter your vendor/store name.');
      return;
    }

    setLoading(true);
    Keyboard.dismiss();

    try {
      const endpoint = authMode === 'register' ? '/api/register' : '/api/login';
      const body = {
        username: cleanUser,
        password: cleanPass,
        role: selectedRole,
        ...(authMode === 'register' ? { full_name: fullName.trim() } : {})
      };

      const res = await fetch(`${BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const resJson = await res.json();

      if (!res.ok || !resJson.success) {
        Alert.alert('Access Denied', resJson.message || 'Incorrect credentials.');
        return;
      }

      await AsyncStorage.setItem(STORAGE_AUTH_USER_KEY, JSON.stringify(resJson.user));
      onLoginSuccess(resJson.user);
    } catch (err) {
      Alert.alert('Connection Failed', `Could not reach backend at ${BASE_URL}.`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={loginStyles.container} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="light-content" backgroundColor="#0b1f0d" />

      {/* Header Banner - Shrinks automatically when typing */}
      <View style={[loginStyles.headerBanner, keyboardVisible && loginStyles.headerBannerCompact]}>
        <Ionicons name="leaf" size={keyboardVisible ? 24 : 32} color="#7EE84A" />
        <Text style={[loginStyles.headerTitle, keyboardVisible && { fontSize: 20, marginTop: 2 }]}>
          SIGLA ANI
        </Text>
        {!keyboardVisible && (
          <Text style={loginStyles.headerSubtitle}>
            Fruit Quality Inspection & Inventory System
          </Text>
        )}
      </View>

      <KeyboardAvoidingView
        style={loginStyles.keyboardAvoid}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <ScrollView
            contentContainerStyle={loginStyles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={loginStyles.card}>
              {/* Toggle Sign In / Register */}
              <View style={loginStyles.modeToggleRow}>
                <TouchableOpacity
                  style={[loginStyles.modeBtn, authMode === 'login' && loginStyles.modeBtnActive]}
                  onPress={() => setAuthMode('login')}
                  activeOpacity={0.7}
                >
                  <Text style={[loginStyles.modeBtnText, authMode === 'login' && loginStyles.modeBtnTextActive]}>
                    Sign In
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[loginStyles.modeBtn, authMode === 'register' && loginStyles.modeBtnActive]}
                  onPress={() => setAuthMode('register')}
                  activeOpacity={0.7}
                >
                  <Text style={[loginStyles.modeBtnText, authMode === 'register' && loginStyles.modeBtnTextActive]}>
                    Register
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Role Selection */}
              <Text style={loginStyles.sectionLabel}>Select Role</Text>
              <View style={loginStyles.roleSelectionRow}>
                <TouchableOpacity
                  style={[
                    loginStyles.roleOptionCard,
                    selectedRole === 'vendor' && loginStyles.roleOptionCardActive
                  ]}
                  onPress={() => setSelectedRole('vendor')}
                  activeOpacity={0.7}
                >
                  <Feather
                    name="shopping-bag"
                    size={18}
                    color={selectedRole === 'vendor' ? '#1E5E3A' : '#64748B'}
                  />
                  <Text
                    style={[
                      loginStyles.roleOptionTitle,
                      selectedRole === 'vendor' && loginStyles.roleOptionTitleActive
                    ]}
                  >
                    Vendor
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    loginStyles.roleOptionCard,
                    selectedRole === 'consumer' && loginStyles.roleOptionCardActive
                  ]}
                  onPress={() => setSelectedRole('consumer')}
                  activeOpacity={0.7}
                >
                  <Feather
                    name="user"
                    size={18}
                    color={selectedRole === 'consumer' ? '#1E5E3A' : '#64748B'}
                  />
                  <Text
                    style={[
                      loginStyles.roleOptionTitle,
                      selectedRole === 'consumer' && loginStyles.roleOptionTitleActive
                    ]}
                  >
                    Consumer
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Store Name for Vendor Registration */}
              {authMode === 'register' && selectedRole === 'vendor' && (
                <>
                  <Text style={loginStyles.fieldLabel}>Vendor / Store Name</Text>
                  <View style={loginStyles.inputWrap}>
                    <Feather name="home" size={16} color="#94A3B8" />
                    <TextInput
                      style={loginStyles.input}
                      placeholder="e.g. Valenzuela Fruit Haven"
                      placeholderTextColor="#94A3B8"
                      value={fullName}
                      onChangeText={setFullName}
                      returnKeyType="next"
                    />
                  </View>
                </>
              )}

              {/* Username Input */}
              <Text style={loginStyles.fieldLabel}>Username</Text>
              <View style={loginStyles.inputWrap}>
                <Feather name="user" size={16} color="#94A3B8" />
                <TextInput
                  style={loginStyles.input}
                  placeholder={selectedRole === 'vendor' ? 'vendor_admin' : 'consumer_buyer'}
                  placeholderTextColor="#94A3B8"
                  autoCapitalize="none"
                  value={username}
                  onChangeText={setUsername}
                  returnKeyType="next"
                />
              </View>

              {/* Password Input with Eye Visibility Toggle */}
              <Text style={loginStyles.fieldLabel}>Password</Text>
              <View style={loginStyles.inputWrap}>
                <Feather name="lock" size={16} color="#94A3B8" />
                <TextInput
                  style={loginStyles.input}
                  placeholder="••••••••"
                  placeholderTextColor="#94A3B8"
                  secureTextEntry={!showPassword}
                  value={password}
                  onChangeText={setPassword}
                  returnKeyType="done"
                  onSubmitEditing={handleAuthAction}
                />
                <TouchableOpacity
                  style={loginStyles.eyeBtn}
                  onPress={() => setShowPassword(prev => !prev)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Feather
                    name={showPassword ? 'eye' : 'eye-off'}
                    size={18}
                    color="#64748B"
                  />
                </TouchableOpacity>
              </View>

              {/* Submit Button */}
              <TouchableOpacity
                style={loginStyles.primaryBtn}
                onPress={handleAuthAction}
                disabled={loading}
                activeOpacity={0.8}
              >
                {loading ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <Feather
                      name={authMode === 'login' ? 'log-in' : 'user-plus'}
                      size={16}
                      color="#FFFFFF"
                    />
                    <Text style={loginStyles.primaryBtnText}>
                      {authMode === 'login'
                        ? `Sign In as ${selectedRole === 'vendor' ? 'Vendor' : 'Consumer'}`
                        : `Create ${selectedRole === 'vendor' ? 'Vendor' : 'Consumer'} Account`}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>

            <Text style={loginStyles.footerHint}>
              Registered accounts are stored securely on the Sigla Ani database server.
            </Text>
          </ScrollView>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}