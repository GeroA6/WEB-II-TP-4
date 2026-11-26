import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ClientMessage,
  ErrorMessage,
  Participant,
  ProductItem,
  ProposalResultMessage,
  ServerMessage,
} from "../../../shared/protocol";

export type SocketConnectionState = "connecting" | "open" | "reconnecting" | "closed";

export interface ParticipantSocketApi {
  connectionState: SocketConnectionState;
  self: Participant | null;
  participants: Participant[];
  products: ProductItem[];
  lastProposalResult: ProposalResultMessage | null;
  isProposing: boolean;
  error: ErrorMessage | null;
  join: (name: string) => void;
  proposeProducts: (productIds: number[]) => void;
  vote: (productId: number) => void;
  unvote: (productId: number) => void;
  removeProduct: (productId: number) => void;
  clearError: () => void;
}

const SESSION_KEY = "tp4_participant_session";
const BASE_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 5000;

interface SavedSession {
  id: string;
  name: string;
}

function getReconnectDelayMs(attempt: number): number {
  return Math.min(BASE_RECONNECT_DELAY_MS * 2 ** attempt, MAX_RECONNECT_DELAY_MS);
}

function readSavedSession(): SavedSession | null {
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedSession>;
    if (
      typeof parsed.id === "string" &&
      parsed.id.length > 0 &&
      typeof parsed.name === "string" &&
      parsed.name.trim().length > 0
    ) {
      return { id: parsed.id, name: parsed.name.trim() };
    }
    return null;
  } catch {
    return null;
  }
}

function persistSavedSession(session: SavedSession | null): void {
  try {
    if (session) {
      window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } else {
      window.sessionStorage.removeItem(SESSION_KEY);
    }
  } catch {
    // Ignorar si sessionStorage no está disponible
  }
}

/**
 * Custom Hook que encapsula la conexión WebSocket estándar del navegador (SRP)
 * con reconexión automática (exponential backoff) y recuperación de identidad (id + nombre) y estado.
 */
export function useParticipantSocket(): ParticipantSocketApi {
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const attemptRef = useRef(0);
  const isUnmountedRef = useRef(false);
  const savedSessionRef = useRef<SavedSession | null>(readSavedSession());

  const [connectionState, setConnectionState] = useState<SocketConnectionState>("connecting");
  const [self, setSelf] = useState<Participant | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [lastProposalResult, setLastProposalResult] = useState<ProposalResultMessage | null>(null);
  const [isProposing, setIsProposing] = useState(false);
  const [error, setError] = useState<ErrorMessage | null>(null);

  useEffect(() => {
    isUnmountedRef.current = false;

    function connect() {
      if (isUnmountedRef.current) {
        return;
      }

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      socketRef.current = ws;

      ws.addEventListener("open", () => {
        if (isUnmountedRef.current) {
          ws.close();
          return;
        }
        attemptRef.current = 0;
        setConnectionState("open");

        // Recuperación automática: reenvía join con nombre e ID de sesión guardados en esta pestaña
        if (savedSessionRef.current) {
          const rejoinMsg: ClientMessage = {
            type: "join",
            name: savedSessionRef.current.name,
            participantId: savedSessionRef.current.id,
          };
          ws.send(JSON.stringify(rejoinMsg));
        }
      });

      ws.addEventListener("close", () => {
        setIsProposing(false);
        if (isUnmountedRef.current) {
          setConnectionState("closed");
          return;
        }

        setConnectionState("reconnecting");
        const delayMs = getReconnectDelayMs(attemptRef.current);
        attemptRef.current += 1;
        reconnectTimerRef.current = window.setTimeout(connect, delayMs);
      });

      ws.addEventListener("message", (event) => {
        let msg: ServerMessage;
        try {
          msg = JSON.parse(String(event.data)) as ServerMessage;
        } catch {
          return;
        }

        switch (msg.type) {
          case "welcome": {
            const session: SavedSession = { id: msg.self.id, name: msg.self.name };
            savedSessionRef.current = session;
            persistSavedSession(session);
            setSelf(msg.self);
            setParticipants(msg.participants);
            setProducts(msg.products);
            setError(null);
            break;
          }
          case "participants_updated":
            setParticipants(msg.participants);
            break;
          case "products_updated":
            setProducts(msg.products);
            break;
          case "proposal_result":
            setIsProposing(false);
            setLastProposalResult(msg);
            break;
          case "error":
            setIsProposing(false);
            setError(msg);
            // Si al reconectar otro usuario tomó nuestro nombre, volvemos al formulario de ingreso
            if (msg.code === "NAME_TAKEN" || msg.code === "INVALID_NAME") {
              savedSessionRef.current = null;
              persistSavedSession(null);
              setSelf(null);
            }
            break;
        }
      });
    }

    connect();

    return () => {
      isUnmountedRef.current = true;
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, []);

  const send = useCallback((message: ClientMessage) => {
    const ws = socketRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setError({
        type: "error",
        code: "INVALID_MESSAGE",
        message: "La conexión WebSocket no está abierta.",
      });
      return;
    }
    setError(null);
    ws.send(JSON.stringify(message));
  }, []);

  const join = useCallback(
    (name: string) => {
      send({ type: "join", name });
    },
    [send]
  );

  const proposeProducts = useCallback(
    (productIds: number[]) => {
      setIsProposing(true);
      setLastProposalResult(null);
      send({ type: "propose_products", productIds });
    },
    [send]
  );

  const vote = useCallback(
    (productId: number) => {
      send({ type: "vote", productId });
    },
    [send]
  );

  const unvote = useCallback(
    (productId: number) => {
      send({ type: "unvote", productId });
    },
    [send]
  );

  const removeProduct = useCallback(
    (productId: number) => {
      send({ type: "remove_product", productId });
    },
    [send]
  );

  const clearError = useCallback(() => setError(null), []);

  return {
    connectionState,
    self,
    participants,
    products,
    lastProposalResult,
    isProposing,
    error,
    join,
    proposeProducts,
    vote,
    unvote,
    removeProduct,
    clearError,
  };
}
