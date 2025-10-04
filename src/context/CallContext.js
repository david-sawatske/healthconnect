import React, {
  createContext,
  useContext,
  useMemo,
  useState,
  useCallback,
} from "react";

const CallContext = createContext(null);

export function CallProvider({ children }) {
  const [incoming, setIncoming] = useState(null);

  const showIncoming = useCallback((data) => {
    setIncoming({
      callerName: data?.callerName ?? "Unknown caller",
      avatarUrl: data?.avatarUrl ?? null,
      conversationId: data?.conversationId ?? null,
      callSessionId: data?.callSessionId ?? null,
      senderId: data?.senderId ?? null,
    });
  }, []);

  const hideIncoming = useCallback(() => setIncoming(null), []);

  const value = useMemo(
    () => ({ incoming, showIncoming, hideIncoming }),
    [incoming, showIncoming, hideIncoming],
  );

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}

export function useCall() {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error("useCall must be used within CallProvider");
  return ctx;
}
