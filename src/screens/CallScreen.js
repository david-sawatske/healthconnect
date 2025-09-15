import React, { useEffect, useState, useCallback } from "react";
import {
  SafeAreaView,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from "react-native";
import { RTCView, mediaDevices } from "react-native-webrtc";

export default function CallScreen({ navigation }) {
  const [localStream, setLocalStream] = useState(null);
  const [muted, setMuted] = useState(false);
  const [videoEnabled, setVideoEnabled] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const stream = await mediaDevices.getUserMedia({
          audio: true,
          video: { facingMode: "user" },
        });
        if (active) setLocalStream(stream);
      } catch (e) {
        console.warn("getUserMedia error:", e);
      }
    })();
    return () => {
      active = false;
      if (localStream) {
        localStream.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      localStream?.getAudioTracks().forEach((t) => (t.enabled = m));
      return !m;
    });
  }, [localStream]);

  const toggleVideo = useCallback(() => {
    setVideoEnabled((v) => {
      localStream?.getVideoTracks().forEach((t) => (t.enabled = !v));
      return !v;
    });
  }, [localStream]);

  const endCall = useCallback(() => {
    localStream?.getTracks().forEach((t) => t.stop());
    navigation.goBack();
  }, [localStream, navigation]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.videoContainer}>
        {localStream ? (
          <RTCView
            streamURL={localStream.toURL()}
            style={styles.localVideo}
            objectFit="cover"
            mirror
          />
        ) : (
          <Text style={{ color: "#fff" }}>Starting camera…</Text>
        )}
      </View>

      <View style={styles.controls}>
        <TouchableOpacity style={styles.controlBtn} onPress={toggleMute}>
          <Text style={styles.controlText}>{muted ? "Unmute" : "Mute"}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.hangupBtn} onPress={endCall}>
          <Text style={styles.hangupText}>End</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.controlBtn} onPress={toggleVideo}>
          <Text style={styles.controlText}>
            {videoEnabled ? "Video Off" : "Video On"}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  videoContainer: { flex: 1, justifyContent: "center", alignItems: "center" },
  localVideo: { width: "100%", height: "100%" },
  controls: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingVertical: 20,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  controlBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: "#222",
    borderRadius: 24,
  },
  hangupBtn: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: "#b00020",
    borderRadius: 24,
  },
  controlText: { color: "#fff" },
  hangupText: { color: "#fff", fontWeight: "700" },
});
