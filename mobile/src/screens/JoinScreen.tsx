import { useState } from "react";
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { decodeQr, type QrPayload } from "@sshare/shared";
import { QrScannerModal } from "./QrScannerModal";

interface Props {
  onJoin: (qr: QrPayload, passcode: string, listenerName: string) => void;
}

export function JoinScreen({ onJoin }: Props): JSX.Element {
  const [rawQr, setRawQr] = useState("");
  const [passcode, setPasscode] = useState("");
  const [listenerName, setListenerName] = useState("");
  const [scannerVisible, setScannerVisible] = useState(false);

  const handleJoin = (): void => {
    let qr: QrPayload;
    try {
      qr = decodeQr(rawQr);
    } catch (err) {
      Alert.alert("Invalid session code", (err as Error).message);
      return;
    }
    if (listenerName.trim().length === 0) {
      Alert.alert("Enter your name");
      return;
    }
    if (qr.requiresPasscode && passcode.trim().length === 0) {
      Alert.alert("Enter the session passcode");
      return;
    }
    onJoin(qr, passcode.trim(), listenerName.trim());
  };

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <Text style={styles.label}>Session details (scan or paste)</Text>
        <TouchableOpacity style={styles.scanButton} onPress={() => setScannerVisible(true)}>
          <Text style={styles.scanButtonText}>📷 Scan QR Code</Text>
        </TouchableOpacity>
      </View>
      <TextInput
        value={rawQr}
        onChangeText={setRawQr}
        placeholder='Scan QR code above or paste payload JSON'
        placeholderTextColor="#64748b"
        style={[styles.input, styles.multiline]}
        multiline
      />
      <Text style={styles.label}>Your name</Text>
      <TextInput
        value={listenerName}
        onChangeText={setListenerName}
        placeholder="e.g. Bob's phone"
        placeholderTextColor="#64748b"
        style={styles.input}
      />
      <Text style={styles.label}>Passcode</Text>
      <TextInput
        value={passcode}
        onChangeText={setPasscode}
        placeholder="6-digit code"
        placeholderTextColor="#64748b"
        keyboardType="number-pad"
        style={styles.input}
      />
      <TouchableOpacity style={styles.button} onPress={handleJoin}>
        <Text style={styles.buttonText}>Join session</Text>
      </TouchableOpacity>

      <QrScannerModal
        visible={scannerVisible}
        onClose={() => setScannerVisible(false)}
        onScanSuccess={(data) => {
          setRawQr(data);
          setScannerVisible(false);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 12 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 8,
  },
  scanButton: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  scanButtonText: {
    color: "#38bdf8",
    fontSize: 13,
    fontWeight: "600",
  },
  label: { color: "#94a3b8", fontSize: 13 },
  input: {
    backgroundColor: "#1e293b",
    color: "#e2e8f0",
    borderRadius: 6,
    padding: 12,
    fontSize: 15,
  },
  multiline: { minHeight: 80, textAlignVertical: "top" },
  button: {
    backgroundColor: "#38bdf8",
    padding: 14,
    borderRadius: 6,
    alignItems: "center",
    marginTop: 12,
  },
  buttonText: { color: "#0f172a", fontWeight: "700", fontSize: 16 },
});
