import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ClientMessage,
  ErrorMessage,
  Participant,
  ProductItem,
  ProposalResultMessage,
  ServerMessage,
} from "../../../shared/protocol";

export type SocketConnectionState = "connecting" | "open" | "closed";

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

/**
 * Custom Hook que encapsula la conexión WebSocket estándar del navegador (SRP).
 * Mantiene el estado sincronizado con el servidor y cierra el socket al desmontar.
 */
export function useParticipantSocket(): ParticipantSocketApi {
  const socketRef = useRef<WebSocket | null>(null);
  const [connectionState, setConnectionState] = useState<SocketConnectionState>("connecting");
  const [self, setSelf] = useState<Participant | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [lastProposalResult, setLastProposalResult] = useState<ProposalResultMessage | null>(null);
  const [isProposing, setIsProposing] = useState(false);
  const [error, setError] = useState<ErrorMessage | null>(null);

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    socketRef.current = ws;

    ws.addEventListener("open", () => {
      setConnectionState("open");
    });

    ws.addEventListener("close", () => {
      setConnectionState("closed");
      setIsProposing(false);
    });

    ws.addEventListener("message", (event) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(event.data)) as ServerMessage;
      } catch {
        return;
      }

      switch (msg.type) {
        case "welcome":
          setSelf(msg.self);
          setParticipants(msg.participants);
          setProducts(msg.products);
          setError(null);
          break;
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
          break;
      }
    });

    return () => {
      ws.close();
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

  const join = useCallback((name: string) => {
    send({ type: "join", name });
  }, [send]);

  const proposeProducts = useCallback(
    (productIds: number[]) => {
      setIsProposing(true);
      setLastProposalResult(null);
      send({ type: "propose_products", productIds });
    },
    [send]
  );

  const vote = useCallback((productId: number) => {
    send({ type: "vote", productId });
  }, [send]);

  const unvote = useCallback((productId: number) => {
    send({ type: "unvote", productId });
  }, [send]);

  const removeProduct = useCallback((productId: number) => {
    send({ type: "remove_product", productId });
  }, [send]);

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
