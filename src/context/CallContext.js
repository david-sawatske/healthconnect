import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
} from "react";

const CallContext = createContext(null);

const initialState = {
  visible: false,
  status: "idle",
  incoming: null,
  error: null,
};

function reducer(state, action) {
  switch (action.type) {
    case "RING":
      return {
        ...state,
        visible: true,
        status: "ringing",
        incoming: action.payload,
        error: null,
      };
    case "HIDE":
      return {
        ...state,
        visible: false,
        status: "idle",
        incoming: null,
        error: null,
      };
    case "CONNECTING":
      return { ...state, status: "connecting", error: null };
    case "IN_CALL":
      return { ...state, status: "in_call", error: null };
    case "ERROR":
      return { ...state, error: action.payload ?? "Unknown error" };
    default:
      return state;
  }
}

export function CallProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const ring = useCallback(
    (incoming) => dispatch({ type: "RING", payload: incoming }),
    [],
  );
  const hide = useCallback(() => dispatch({ type: "HIDE" }), []);
  const setConnecting = useCallback(() => dispatch({ type: "CONNECTING" }), []);
  const setInCall = useCallback(() => dispatch({ type: "IN_CALL" }), []);
  const setError = useCallback(
    (e) => dispatch({ type: "ERROR", payload: e }),
    [],
  );

  const value = useMemo(
    () => ({
      ...state,
      ring,
      hide,
      setConnecting,
      setInCall,
      setError,
    }),
    [state, ring, hide, setConnecting, setInCall, setError],
  );

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}

export function useCall() {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error("useCall must be used within CallProvider");
  return ctx;
}
