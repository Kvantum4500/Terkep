import type { CapacitorConfig } from '@capacitor/cli'

// Natív Android-app (APK, Play Áruház nélkül). A webes buildet csomagolja be
// (BASE_PATH=/ VITE_NATIVE=1 npm run build), így az adatok az APK-ban vannak és
// offline is működik; a háttérben is rögzítő GPS a natív bővítménnyel megy.
const config: CapacitorConfig = {
  appId: 'io.github.kvantum4500.terkep',
  appName: 'Látnivalók',
  webDir: 'dist',
  server: { androidScheme: 'https' },
  android: {
    // a háttér-helymeghatározó bővítmény ajánlása: e nélkül 5 perc után leállhatnak a helyfrissítések
    useLegacyBridge: true,
  },
}

export default config
