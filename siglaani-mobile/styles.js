import { StyleSheet, Dimensions } from 'react-native';

const { width } = Dimensions.get('window');
const SCAN_BOX_SIZE = width * 0.72;

export const COLORS = {
  bg: '#0F2615',
  card: '#16381E',
  primary: '#7EE84A',
  text: '#FFFFFF',
  textSub: '#A3B899',
  border: '#24522C',
  danger: '#EF4444',
  ripe: '#7EE84A',
  rotten: '#EF4444',
};

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  header: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: COLORS.primary,
    letterSpacing: 1.5,
  },
  navTabs: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  activeTabBtn: {
    borderBottomWidth: 3,
    borderBottomColor: COLORS.primary,
  },
  tabText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textSub,
  },
  activeTabText: {
    color: COLORS.primary,
  },
  body: {
    flex: 1,
    padding: 16,
  },
  cameraContainer: {
    flex: 1,
    borderRadius: 20,
    overflow: 'hidden',
    position: 'relative',
  },
  camera: {
    flex: 1,
  },
  // Viewfinder Overlay
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  scanBox: {
    width: SCAN_BOX_SIZE,
    height: SCAN_BOX_SIZE,
    position: 'relative',
    backgroundColor: 'transparent',
  },
  corner: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderColor: COLORS.primary,
  },
  tl: { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 8 },
  tr: { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 8 },
  bl: { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 8 },
  br: { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 8 },
  scanHint: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: '700',
    marginTop: 24,
    textAlign: 'center',
    letterSpacing: 0.5,
    backgroundColor: 'rgba(15, 38, 21, 0.85)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 16,
  },
  fruitTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: COLORS.text,
  },
  scientific: {
    fontSize: 14,
    fontStyle: 'italic',
    color: COLORS.textSub,
    marginBottom: 12,
  },
  statusBadge: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  statusText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#000000',
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  metaLabel: {
    color: COLORS.textSub,
    fontSize: 14,
  },
  metaVal: {
    color: COLORS.text,
    fontWeight: '700',
    fontSize: 14,
  },
  recoBox: {
    marginTop: 12,
    padding: 12,
    backgroundColor: 'rgba(0,0,0,0.25)',
    borderRadius: 8,
  },
  recoTitle: {
    fontSize: 12,
    color: COLORS.primary,
    fontWeight: '700',
    marginBottom: 4,
  },
  recoText: {
    fontSize: 13,
    color: COLORS.text,
    lineHeight: 18,
  },
  btn: {
    backgroundColor: COLORS.primary,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 10,
  },
  btnText: {
    color: '#0F2615',
    fontSize: 16,
    fontWeight: '800',
  },

  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  cardHeaderLeft: {
    flex: 1,
    paddingRight: 14,
  },
  fruitImage: {
    width: 95,
    height: 95,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    backgroundColor: '#0a1a0e',
  },
});