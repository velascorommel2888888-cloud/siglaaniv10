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
  const [authMode, setAuthMode] = useState('login'); // 'login', 'register', or 'forgot'
  const [selectedRole, setSelectedRole] = useState('vendor'); // 'vendor' or 'consumer'
  
  // Form input states
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  // Password visibility toggles
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  
  // Forgot password flow states
  const [resetStep, setResetStep] = useState(1); // 1: enter username, 2: enter code & new password
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [maskedPhone, setMaskedPhone] = useState('');

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

    if (authMode === 'register') {
      if (!phoneNumber.trim()) {
        Alert.alert('Required Fields', 'Please enter your phone number for account recovery.');
        return;
      }
      if (selectedRole === 'vendor' && !fullName.trim()) {
        Alert.alert('Required Fields', 'Please enter your store or vendor name.');
        return;
      }
      if (cleanPass !== confirmPassword.trim()) {
        Alert.alert('Password Mismatch', 'Passwords do not match. Please check and try again.');
        return;
      }
    }

    setLoading(true);
    Keyboard.dismiss();

    try {
      const endpoint = authMode === 'register' ? '/api/register' : '/api/login';
      const body = {
        username: cleanUser,
        password: cleanPass,
        role: selectedRole,
        ...(authMode === 'register' ? { 
          full_name: fullName.trim(),
          phone_number: phoneNumber.trim()
        } : {})
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

  const handleRequestResetCode = async () => {
    if (!username.trim()) {
      Alert.alert('Required', 'Please enter your username first.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${BASE_URL}/api/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim() })
      });
      const resJson = await res.json();

      if (!res.ok || !resJson.success) {
        Alert.alert('Error', resJson.message || 'Username not found.');
        return;
      }

      setMaskedPhone(resJson.masked_phone || 'your phone number');
      setResetStep(2);
      Alert.alert('Code Sent!', resJson.message);
    } catch (e) {
      Alert.alert('Error', 'Could not reach server.');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmResetPassword = async () => {
    if (!resetCode.trim() || !newPassword.trim()) {
      Alert.alert('Required', 'Please enter the verification code and your new password.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${BASE_URL}/api/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          code: resetCode.trim(),
          new_password: newPassword.trim()
        })
      });
      const resJson = await res.json();

      if (!res.ok || !resJson.success) {
        Alert.alert('Reset Failed', resJson.message || 'Invalid code.');
        return;
      }

      Alert.alert('Success', resJson.message);
      setAuthMode('login');
      setResetStep(1);
      setPassword('');
      setNewPassword('');
      setResetCode('');
    } catch (e) {
      Alert.alert('Error', 'Could not reach server.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={loginStyles.container} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="light-content" backgroundColor="#0b1f0d" />

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
              {authMode !== 'forgot' && (
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
              )}

              {/* Forgot Password View Title */}
              {authMode === 'forgot' && (
                <View style={{ marginBottom: 16 }}>
                  <Text style={{ fontSize: 18, fontWeight: '900', color: '#0F172A' }}>Reset Password</Text>
                  <Text style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>
                    {resetStep === 1 
                      ? 'Enter your account username to receive an SMS verification code.' 
                      : `Enter the 6-digit code sent to ${maskedPhone}`}
                  </Text>
                </View>
              )}

              {/* Role Selection (Only for Sign In / Register) */}
              {authMode !== 'forgot' && (
                <>
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
                </>
              )}

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
                  editable={authMode !== 'forgot' || resetStep === 1}
                />
              </View>

              {/* Phone Number Input (Registration Only) */}
              {authMode === 'register' && (
                <>
                  <Text style={loginStyles.fieldLabel}>Phone Number (for SMS Recovery)</Text>
                  <View style={loginStyles.inputWrap}>
                    <Feather name="phone" size={16} color="#94A3B8" />
                    <TextInput
                      style={loginStyles.input}
                      placeholder="09123456789"
                      placeholderTextColor="#94A3B8"
                      keyboardType="phone-pad"
                      value={phoneNumber}
                      onChangeText={setPhoneNumber}
                    />
                  </View>
                </>
              )}

              {/* Forgot Password Step 2: Code & New Password */}
              {authMode === 'forgot' && resetStep === 2 && (
                <>
                  <Text style={loginStyles.fieldLabel}>6-Digit Verification Code</Text>
                  <View style={loginStyles.inputWrap}>
                    <Feather name="shield" size={16} color="#94A3B8" />
                    <TextInput
                      style={loginStyles.input}
                      placeholder="123456"
                      placeholderTextColor="#94A3B8"
                      keyboardType="number-pad"
                      maxLength={6}
                      value={resetCode}
                      onChangeText={setResetCode}
                    />
                  </View>

                  <Text style={loginStyles.fieldLabel}>New Password</Text>
                  <View style={loginStyles.inputWrap}>
                    <Feather name="lock" size={16} color="#94A3B8" />
                    <TextInput
                      style={loginStyles.input}
                      placeholder="••••••••"
                      placeholderTextColor="#94A3B8"
                      secureTextEntry={!showPassword}
                      value={newPassword}
                      onChangeText={setNewPassword}
                    />
                    <TouchableOpacity
                      style={loginStyles.eyeBtn}
                      onPress={() => setShowPassword(prev => !prev)}
                    >
                      <Feather name={showPassword ? 'eye' : 'eye-off'} size={18} color="#64748B" />
                    </TouchableOpacity>
                  </View>
                </>
              )}

              {/* Password Input (Sign In / Register) */}
              {authMode !== 'forgot' && (
                <>
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
                    />
                    <TouchableOpacity
                      style={loginStyles.eyeBtn}
                      onPress={() => setShowPassword(prev => !prev)}
                    >
                      <Feather name={showPassword ? 'eye' : 'eye-off'} size={18} color="#64748B" />
                    </TouchableOpacity>
                  </View>

                  {/* Forgot Password Link on Sign In */}
                  {authMode === 'login' && (
                    <TouchableOpacity onPress={() => setAuthMode('forgot')}>
                      <Text style={loginStyles.forgotPasswordText}>Forgot Password?</Text>
                    </TouchableOpacity>
                  )}
                </>
              )}

              {/* Confirm Password Input (Registration Only) */}
              {authMode === 'register' && (
                <>
                  <Text style={loginStyles.fieldLabel}>Confirm Password</Text>
                  <View style={loginStyles.inputWrap}>
                    <Feather name="lock" size={16} color="#94A3B8" />
                    <TextInput
                      style={loginStyles.input}
                      placeholder="••••••••"
                      placeholderTextColor="#94A3B8"
                      secureTextEntry={!showConfirmPassword}
                      value={confirmPassword}
                      onChangeText={setConfirmPassword}
                    />
                    <TouchableOpacity
                      style={loginStyles.eyeBtn}
                      onPress={() => setShowConfirmPassword(prev => !prev)}
                    >
                      <Feather name={showConfirmPassword ? 'eye' : 'eye-off'} size={18} color="#64748B" />
                    </TouchableOpacity>
                  </View>
                </>
              )}

              {/* Submit / Action Button */}
              <TouchableOpacity
                style={loginStyles.primaryBtn}
                onPress={
                  authMode === 'forgot'
                    ? (resetStep === 1 ? handleRequestResetCode : handleConfirmResetPassword)
                    : handleAuthAction
                }
                disabled={loading}
                activeOpacity={0.8}
              >
                {loading ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <Feather
                      name={authMode === 'register' ? 'user-plus' : (authMode === 'forgot' ? 'send' : 'log-in')}
                      size={16}
                      color="#FFFFFF"
                    />
                    <Text style={loginStyles.primaryBtnText}>
                      {authMode === 'login'
                        ? `Sign In as ${selectedRole === 'vendor' ? 'Vendor' : 'Consumer'}`
                        : authMode === 'register'
                        ? `Create ${selectedRole === 'vendor' ? 'Vendor' : 'Consumer'} Account`
                        : (resetStep === 1 ? 'Send Recovery Code' : 'Update Password')}
                    </Text>
                  </>
                )}
              </TouchableOpacity>

              {/* Back to Sign In Link when in Forgot Password mode */}
              {authMode === 'forgot' && (
                <TouchableOpacity onPress={() => { setAuthMode('login'); setResetStep(1); }}>
                  <Text style={loginStyles.backToLoginText}>Back to Sign In</Text>
                </TouchableOpacity>
              )}
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