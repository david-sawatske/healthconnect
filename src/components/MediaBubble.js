import React, { useEffect, useState } from "react";
import { Image, Text, TouchableOpacity, Linking } from "react-native";
import { getMediaUrl } from "../features/chat/chatService";

export default function MediaBubble({ mediaKey, type }) {
  const [url, setUrl] = useState(null);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const u = await getMediaUrl(mediaKey, { expiresIn: 300 });
        if (mounted) setUrl(u);
      } catch (e) {
        console.log("[CHAT] getUrl error:", e);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [mediaKey]);

  if (!url) {
    return <Text style={{ opacity: 0.6 }}>Loading attachment…</Text>;
  }

  if (type === "IMAGE") {
    return (
      <Image
        source={{ uri: url }}
        style={{
          width: 220,
          height: 220,
          borderRadius: 8,
          backgroundColor: "#ddd",
          marginTop: 6,
        }}
        resizeMode="cover"
      />
    );
  }

  const label = type === "VIDEO" ? "Open video" : "Open file";

  return (
    <TouchableOpacity
      onPress={() => Linking.openURL(url)}
      style={{
        marginTop: 6,
        paddingVertical: 8,
        paddingHorizontal: 10,
        borderRadius: 8,
        backgroundColor: "#f2f2f2",
        alignSelf: "flex-start",
      }}
    >
      <Text style={{ fontSize: 13, fontWeight: "600" }}>{label}</Text>
    </TouchableOpacity>
  );
}
