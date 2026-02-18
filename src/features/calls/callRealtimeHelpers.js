export function parseOfferPayload(payload) {
  let parsed = null;
  try {
    parsed = typeof payload === "string" ? JSON.parse(payload) : payload;
  } catch {}

  const offer = parsed?.offer ?? parsed ?? null;

  return {
    parsed,
    offer,
    callerName: parsed?.callerName ?? offer?.callerName ?? "Unknown caller",
  };
}

export function handleIncomingOfferSignal({ signal, myId, call }) {
  const s = signal;
  if (!s?.id) return;

  if (s.senderId === myId) return;
  if (String(s.type).toUpperCase() !== "OFFER") return;

  const { offer, callerName } = parseOfferPayload(s.payload);

  const incoming = {
    conversationId: s.conversationId,
    callSessionId: s.callSessionId,
    senderId: s.senderId,
    offer,
    callerName,
  };

  if (call?.showIncoming) {
    call.showIncoming(incoming);
  } else if (call?.ring) {
    call.ring(incoming);
  } else {
    console.log(
      "[CALL_REALTIME] Incoming OFFER received but CallContext missing showIncoming/ring.",
      incoming,
    );
  }
}
