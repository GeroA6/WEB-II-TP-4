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
  roomCode: string;
  connectionState: SocketConnectionState;
  self: Participant | null;
  participants: Participant[];
  products: ProductItem[];
  lastProposalResult: ProposalResultMessage | null;
  isProposing: boolean;
  error: ErrorMessage | null;
  join: (name: string, targetRoomCode?: string) => void;
  proposeProducts: (productIds: number[]) => void;
  vote: (productId: number) => void;
  unvote: (productId: number) => void;
  removeProduct: (productId: number) => void;
  clearError: () => void;
}

const SESSION_KEY = "tp4_participant_session";
const DEFAULT_ROOM_CODE = "GENERAL";
const BASE_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 5000;

interface SavedSession {
  id: string;
  name: string;
  roomCode: string;
}

function getReconnectDelayMs(attempt: number): number {
  return Math.min(BASE_RECONNECT_DELAY_MS * 2 ** attempt, MAX_RECONNECT_DELAY_MS);
}

function readRoomFromUrl(): string | null {
  const param = new URLSearchParams(window.location.search).get("room");
  return param && param.trim().length > 0 ? param.trim().toUpperCase() : null;
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
      parsed.name.trim().length > 0 &&
      typeof parsed.roomCode === "string" &&
      parsed.roomCode.trim().length > 0
    ) {
      return {
        id: parsed.id,
        name: parsed.name.trim(),
        roomCode: parsed.roomCode.trim().toUpperCase(),
      };
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

function getInitialRoomCode(saved: SavedSession | null): string {
  return readRoomFromUrl() ?? saved?.roomCode ?? DEFAULT_ROOM_CODE;
}

/**
 * Custom Hook que encapsula la conexión WebSocket estándar del navegador (SRP)
 * con soporte de salas independientes (?room=...), reconexión automática y persistencia de sesión.
 */
export function useParticipantSocket(): ParticipantSocketApi {
  const initialSaved = readSavedSession();
  const initialRoom = getInitialRoomCode(initialSaved);

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const attemptRef = useRef(0);
  const savedSessionRef = useRef<SavedSession | null>(
    initialSaved && initialSaved.roomCode === initialRoom ? initialSaved : null
  );
  const pendingJoinNameRef = useRef<string | null>(null);

  const [roomCode, setRoomCode] = useState<string>(initialRoom);
  const [connectionState, setConnectionState] = useState<SocketConnectionState>("connecting");
  const [self, setSelf] = useState<Participant | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [lastProposalResult, setLastProposalResult] = useState<ProposalResultMessage | null>(null);
  const [isProposing, setIsProposing] = useState(false);
  const [error, setError] = useState<ErrorMessage | null>(null);

  useEffect(() => {
    let cancelled = false;
    attemptRef.current = 0;
    setConnectionState("connecting");

    function connect() {
      if (cancelled) {
        return;
      }

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(
        `${protocol}//${window.location.host}/ws?room=${encodeURIComponent(roomCode)}`
      );
      socketRef.current = ws;

      ws.addEventListener("open", () => {
        if (cancelled) {
          ws.close();
          return;
        }
        attemptRef.current = 0;
        setConnectionState("open");

        if (pendingJoinNameRef.current) {
          const name = pendingJoinNameRef.current;
          pendingJoinNameRef.current = null;
          ws.send(JSON.stringify({ type: "join", name } satisfies ClientMessage));
          return;
        }

        if (savedSessionRef.current && savedSessionRef.current.roomCode === roomCode) {
          const rejoinMsg: ClientMessage = {
            type: "join",
            name: savedSessionRef.current.name,
            participantId: savedSessionRef.current.id,
          };
          ws.send(JSON.stringify(rejoinMsg));
        }
      });

      ws.addEventListener("close", (event) => {
        setIsProposing(false);
        if (cancelled) {
          return;
        }
        // Código 1008 = política violada (ej. código de sala inválido): no reconectar en bucle
        if (event.code === 1008) {
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
            const session: SavedSession = {
              id: msg.self.id,
              name: msg.self.name,
              roomCode: msg.roomCode,
            };
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
      cancelled = true;
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [roomCode]);

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
    (name: string, targetRoomCode?: string) => {
      const normalizedRoom = (targetRoomCode?.trim() || roomCode).toUpperCase();
      if (!/^[A-Z0-9-]{2,20}$/.test(normalizedRoom)) {
        setError({
          type: "error",
          code: "INVALID_MESSAGE",
          message: "El código de lista debe tener entre 2 y 20 caracteres (letras, números o guiones).",
        });
        return;
      }

      if (normalizedRoom !== roomCode) {
        setError(null);
        savedSessionRef.current = null;
        persistSavedSession(null);
        pendingJoinNameRef.current = name;
        const nextUrl = `/?room=${encodeURIComponent(normalizedRoom)}`;
        window.history.replaceState(null, "", nextUrl);
        setRoomCode(normalizedRoom);
        return;
      }

      send({ type: "join", name });
    },
    [roomCode, send]
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
    roomCode,
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
