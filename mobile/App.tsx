import { useState } from "react";
import { StatusBar } from "expo-status-bar";
import { SafeAreaView, StyleSheet, Text, View } from "react-native";
import { JoinScreen } from "./src/screens/JoinScreen";
import { ListeningScreen } from "./src/screens/ListeningScreen";
import type { QrPayload } from "@sshare/shared";

type Screen =
  | { kind: "join" }
  | { kind: "listening"; qr: QrPayload; passcode: string; listenerName: string };

export default function App(): JSX.Element {
  const [screen, setScreen] = useState<Screen>({ kind: "join" });

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Text style={styles.title}>SShare</Text>
      </View>
      {screen.kind === "join" && (
        <JoinScreen
          onJoin={(qr, passcode, listenerName) =>
            setScreen({ kind: "listening", qr, passcode, listenerName })
          }
        />
      )}
      {screen.kind === "listening" && (
        <ListeningScreen
          qr={screen.qr}
          passcode={screen.passcode}
          listenerName={screen.listenerName}
          onLeave={() => setScreen({ kind: "join" })}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0f172a" },
  header: { padding: 20, borderBottomWidth: 1, borderBottomColor: "#1e293b" },
  title: { color: "#e2e8f0", fontSize: 22, fontWeight: "700" },
});
