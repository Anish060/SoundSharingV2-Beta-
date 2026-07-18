import { useState } from "react";
import { Alert, Modal, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { decodeQr } from "@sshare/shared";

interface Props {
  visible: boolean;
  onClose: () => void;
  onScanSuccess: (rawQr: string) => void;
}

export function QrScannerModal({ visible, onClose, onScanSuccess }: Props): JSX.Element {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);

  if (!visible) return <></>;

  if (!permission) {
    return (
      <Modal visible={visible} animationType="slide">
        <View style={styles.container}>
          <Text style={styles.text}>Requesting camera permission...</Text>
        </View>
      </Modal>
    );
  }

  if (!permission.granted) {
    return (
      <Modal visible={visible} animationType="slide">
        <View style={styles.container}>
          <Text style={styles.text}>SShare needs camera permission to scan QR codes</Text>
          <TouchableOpacity style={styles.button} onPress={requestPermission}>
            <Text style={styles.buttonText}>Grant Permission</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.button, styles.cancelButton]} onPress={onClose}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    );
  }

  const handleBarcodeScanned = ({ data }: { data: string }) => {
    if (scanned) return;
    setScanned(true);

    try {
      decodeQr(data);
      onScanSuccess(data);
      setScanned(false);
    } catch (err: any) {
      Alert.alert("Invalid SShare QR Code", err.message);
      // Timeout to debounce scanner so alerts don't stack up
      setTimeout(() => setScanned(false), 2000);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.scannerContainer}>
        <CameraView
          style={StyleSheet.absoluteFillObject}
          facing="back"
          barcodeScannerSettings={{
            barcodeTypes: ["qr"],
          }}
          onBarcodeScanned={handleBarcodeScanned}
        />

        {/* Framing Overlay */}
        <View style={styles.overlay}>
          <View style={styles.unfocusedContainer} />
          <View style={styles.middleContainer}>
            <View style={styles.unfocusedContainer} />
            <View style={styles.focusedContainer} />
            <View style={styles.unfocusedContainer} />
          </View>
          <View style={styles.unfocusedContainer} />
        </View>

        {/* Footer controls */}
        <View style={styles.footer}>
          <TouchableOpacity style={styles.closeButton} onPress={onClose}>
            <Text style={styles.closeButtonText}>Close Scanner</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#0f172a",
    padding: 20,
    gap: 16,
  },
  scannerContainer: {
    flex: 1,
    backgroundColor: "#000",
  },
  text: {
    color: "#cbd5e1",
    fontSize: 16,
    textAlign: "center",
    marginBottom: 10,
  },
  button: {
    backgroundColor: "#38bdf8",
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 6,
    alignItems: "center",
    width: 200,
  },
  cancelButton: {
    backgroundColor: "#334155",
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 6,
    alignItems: "center",
    width: 200,
  },
  buttonText: {
    color: "#0f172a",
    fontWeight: "700",
    fontSize: 15,
  },
  cancelText: {
    color: "#e2e8f0",
    fontWeight: "600",
    fontSize: 15,
  },
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  unfocusedContainer: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.6)",
  },
  middleContainer: {
    flexDirection: "row",
    height: 280,
  },
  focusedContainer: {
    width: 280,
    borderWidth: 2,
    borderColor: "#38bdf8",
    borderRadius: 12,
    backgroundColor: "transparent",
  },
  footer: {
    position: "absolute",
    bottom: 50,
    left: 20,
    right: 20,
    alignItems: "center",
  },
  closeButton: {
    backgroundColor: "rgba(15, 23, 42, 0.85)",
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#334155",
  },
  closeButtonText: {
    color: "#e2e8f0",
    fontWeight: "600",
    fontSize: 15,
  },
});
